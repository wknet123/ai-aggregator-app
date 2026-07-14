"""
Loop Harness 数据模型（P0-a 骨架）—— 自定义智能体一次运行的持久化。

P0-a 精简：只建 agent_runs + agent_steps 两张表 + 一个内置 default agent（代码常量）。
Agent/Skill 定义表留到 P1（前端 AgentStudio）。详见 docs/loop-harness-integration.md。

MinIO 产物布局：users/{uid}/agents/{run_id}/...
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON
from app.db.base import Base


class AgentRun(Base):
    """一次「下达目标 → 智能体执行 → 产出成品」的运行。"""
    __tablename__ = "agent_runs"

    run_id     = Column(String(36), unique=True, index=True, nullable=False)
    user_id    = Column(Integer, nullable=False, index=True)
    tenant_id  = Column(Integer, nullable=False, index=True)

    agent_key  = Column(String(64), default="default")   # P0: 内置 default agent
    goal       = Column(Text, nullable=False)            # 用户目标（自然语言）
    inputs     = Column(JSON, nullable=True)             # 用户提供的素材引用

    # pending / running / awaiting_confirmation / completed / failed / cancelled
    status     = Column(String(30), default="pending", index=True)
    progress   = Column(Integer, default=0)              # 0-100

    # 人工确认模式（P0-b-2）：auto=直通 / checkpoint=单步花费≥阈值时挂起 / step=每次工具调用前挂起
    confirm_mode          = Column(String(20), default="auto")
    pending_confirmation  = Column(JSON, nullable=True)  # 挂起时待确认的 payload（供前端展示待执行动作）
    confirm_decision      = Column(JSON, nullable=True)  # 用户确认决定（worker 恢复时消费后清空）

    plan            = Column(JSON, nullable=True)        # 智能体规划（供前端展示）
    final_artifacts = Column(JSON, nullable=True)        # 最终产物引用列表
    total_cost      = Column(Integer, default=0)         # 累计扣费（P0-a 恒 0）
    error_message   = Column(Text, nullable=True)

    # P1-a：Run 启动时的合并后运行配置快照（persona/allowed_plugins/policy/constraints），
    # 防 Agent/Skill 定义在 Run 进行中被编辑而污染历史 Run；续跑也读此快照保证一致。
    agent_snapshot  = Column(JSON, nullable=True)

    deleted_at = Column(DateTime, nullable=True)


class AgentStep(Base):
    """Run 内的一个动作节点 / 轨迹（供前端逐步展示 + 续跑幂等）。"""
    __tablename__ = "agent_steps"

    run_id      = Column(String(36), index=True, nullable=False)
    step_index  = Column(Integer, default=0)

    type        = Column(String(20), default="tool_call")   # plan / tool_call / summary
    plugin_name = Column(String(64), nullable=True)
    tool_call_id = Column(String(64), nullable=True, index=True)  # LLM tool_call id（幂等键，防续跑重复扣费/执行）
    thought     = Column(Text, nullable=True)               # LLM 思考文本
    input_data  = Column(JSON, nullable=True)               # Plugin 入参
    output_data = Column(JSON, nullable=True)               # Plugin 产物引用 + 元数据

    # pending / processing / completed / failed / skipped
    status      = Column(String(20), default="completed")
    cost        = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)


class Agent(Base):
    """自定义智能体定义（P1-a）：persona + 有序 Skill 列表 + Plugin 白名单 + policy。

    Run 启动时按 agent_id 加载、合并 Skill、快照进 agent_runs.agent_snapshot。
    agent_id="default" 为内置系统智能体（启动播种）。
    """
    __tablename__ = "agents"

    agent_id    = Column(String(36), unique=True, index=True, nullable=False)  # 对外标识（uuid 或 "default"）
    tenant_id   = Column(Integer, nullable=True, index=True)   # system 级可空
    user_id     = Column(Integer, nullable=True, index=True)   # 创建者

    name        = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    avatar      = Column(String(255), nullable=True)           # 头像/图标
    persona     = Column(Text, nullable=False)                 # 系统人设

    skill_ids       = Column(JSON, nullable=True)   # 有序 skill_id 列表
    allowed_plugins = Column(JSON, nullable=True)   # Plugin 硬白名单
    # {max_steps, budget_limit, confirm_mode, confirm_cost_threshold, default_aspect_ratio, model}
    policy          = Column(JSON, nullable=True)
    # 声明式「用户输入」定义（运行时据此渲染动态表单）：
    # [{key,label,type(text|textarea|number|select|image),required,placeholder,options,help}]
    input_schema    = Column(JSON, nullable=True)

    scope       = Column(String(20), default="private", index=True)  # system / tenant / private
    is_active   = Column(Integer, default=1)
    deleted_at  = Column(DateTime, nullable=True)


class Skill(Base):
    """技能定义（P1-a）：一套方法论 Prompt + 推荐 Plugin + 输入输出槽 + 约束。

    instructions 是核心——合并进智能体 system prompt。version 编辑即自增，Run 快照引用。
    """
    __tablename__ = "skills"

    skill_id    = Column(String(36), unique=True, index=True, nullable=False)
    tenant_id   = Column(Integer, nullable=True, index=True)   # system 级可空
    user_id     = Column(Integer, nullable=True, index=True)

    name        = Column(String(128), nullable=False)
    category    = Column(String(32), nullable=True)   # 图片创作 | 影视创作 | 音频创作 | 通用
    icon        = Column(String(64), nullable=True)
    description = Column(Text, nullable=True)
    when_to_use = Column(Text, nullable=True)         # 帮助智能体判断何时套用
    instructions = Column(Text, nullable=False)       # 方法论 Prompt（注入 system）

    recommended_plugins = Column(JSON, nullable=True)
    inputs      = Column(JSON, nullable=True)          # [{key,type,required,label}]
    outputs     = Column(JSON, nullable=True)
    constraints = Column(JSON, nullable=True)          # {aspect_ratio,max_duration_sec,forbidden_words}
    few_shot    = Column(JSON, nullable=True)

    scope       = Column(String(20), default="private", index=True)
    version     = Column(Integer, default=1)           # 编辑自增
    deleted_at  = Column(DateTime, nullable=True)
