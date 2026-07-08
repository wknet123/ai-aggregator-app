# 自定义智能体（Custom Agent）— SKILL × Plugin 编排创作 · 需求与设计文档

> 本文档定义一种全新的 AI 创作方式：用户以**自定义智能体（Custom Agent）**的形式，选择或自定义**一个或多个 SKILL（技能）**，由智能体自主编排、调用平台的**图片 / 影视 / 音频处理 Plugin**，最终产出成品。
>
> 定位：这是继「AIWorkbench（单步生成台）」「OmniWeaverPro（短剧固定流水线）」之后的**第三种、也是最开放的创作范式** —— 从"用户手动串步骤"升级为"用户描述目标 + 选定技能，智能体自主完成"。
>
> 执行范式（已确认）：**自主智能体优先**。LLM 依据所选 SKILL 的指令自主规划步骤、决定调用哪些 Plugin、按什么顺序、传什么参数；用户可在关键节点介入确认。
>
> 音频范围（已确认）：**全量纳入设计，实现分期**。图片 + 影视为一期，音频（TTS 配音 / ASR 字幕 / 音乐 / 音效 / 混音）完整设计但分期落地。

---

## 0. 术语表

| 术语 | 定义 |
|---|---|
| **Agent（智能体）** | 一个可复用的创作单元 = 系统人设 + 若干 SKILL + 可用 Plugin 白名单 + 运行策略。用户可用平台预置 Agent，也可自定义。 |
| **SKILL（技能）** | 一段结构化的"做事方法论"：告诉智能体**在什么场景、按什么套路、用哪些 Plugin、遵守什么约束**去完成一类创作。可组合（一个 Agent 挂多个 SKILL）。 |
| **Plugin（插件）** | 平台提供的**原子能力**，封装底层 `gateway` 的一次具体调用。三大族：`image.*`（图片处理）、`video.*`（影视处理）、`audio.*`（音频处理）。 |
| **Run（运行 / 会话）** | 用户一次"下达目标 → 智能体执行 → 产出成品"的完整过程。对应一条 `AgentRun` 记录。 |
| **Step（步骤）** | Run 内智能体规划出的一个动作节点，通常对应一次 Plugin 调用或一次 LLM 推理。 |
| **Tool Call（工具调用）** | 智能体（LLM）通过 function-calling 触发一个 Plugin，是 Step 的底层执行形式。 |
| **Artifact（产物）** | Step 产出的中间/最终资产（图片、视频、音频、文本），落 MinIO，可在步骤间流转、可复用。 |

---

## 1. 背景与目标

### 1.1 为什么要做

现有两种范式各有天花板：

| 范式 | 现状 | 局限 |
|---|---|---|
| **AIWorkbench** | 单步生成，聊天式，用户手动选模型/填参数 | 只能做"一次调用一个产物"，多步创作要人肉串联 |
| **OmniWeaverPro** | 短剧固定 3 步流水线（剧本→分镜→成片） | 流程写死、只服务短剧，无法迁移到其它创作意图 |

**缺口**：平台缺少一个**通用、可复用、目标驱动**的创作层——用户只想说"我要一个 15 秒竖屏带货短视频/一张电商主图/一段有配音的解说视频"，而不想关心中间要调多少个模型、按什么顺序。

本功能填补这个缺口，同时补齐平台的三块空白（探索代码库已确认）：

1. **无 Agent 抽象** —— 全新建。
2. **无 SKILL 抽象** —— 全新建。
3. **无任何音频能力** —— 新增 `audio.*` Plugin 族与 gateway 音频集成。

### 1.2 产品目标

- **降低门槛**：用户用自然语言描述目标即可产出多模态成品，无需理解模型细节。
- **可复用**：把成功的创作套路沉淀成 SKILL 与 Agent，个人/租户内共享、复用。
- **可组合**：一个 Agent 可挂多个 SKILL；一个 SKILL 可调用多个 Plugin；Plugin 产物可跨步骤流转。
- **可控**：虽是自主智能体，但提供人工确认节点、预算上限、Plugin 白名单、可中断/续跑。
- **可计费**：沿用租户级积分体系，Run 内每步透明扣费，失败退款。

### 1.3 非目标（本期不做）

- 不做可视化拖拽 DAG 画布（自主范式下步骤由智能体规划，非用户连线）。
- 不做多智能体协作（multi-agent debate/团队）——单智能体 + 工具调用即可。
- 不做 SKILL 的图灵完备脚本语言——SKILL 是结构化 Prompt + 约束，不是代码。
- 不引入 Celery/独立队列（沿用 BackgroundTasks，见 §7.4 风险与演进）。

---

## 2. 核心概念模型：Agent / SKILL / Plugin 三层

```
┌─────────────────────────────────────────────────────────────┐
│  Agent（智能体）  = 人设 + SKILL 集合 + Plugin 白名单 + 策略   │
│    "带货短视频导演"                                            │
│      ├─ SKILL: 电商分镜法   ┐                                 │
│      ├─ SKILL: 竖屏节奏法   ├─ 决定"怎么做"                    │
│      └─ SKILL: 口播配音法   ┘                                 │
├─────────────────────────────────────────────────────────────┤
│  编排引擎（Orchestrator）                                      │
│    LLM 依据 SKILL 规划 → function-calling 调 Plugin → 观察产物 │
│    → 决定下一步 → ... → 汇总成品                               │
├─────────────────────────────────────────────────────────────┤
│  Plugin（插件，原子能力，封装 gateway）                        │
│    image.*         video.*          audio.*                   │
│    ├ generate      ├ image_to_video ├ tts（配音）             │
│    ├ edit/inpaint  ├ video_to_video ├ asr（字幕）             │
│    ├ upscale       ├ motion         ├ music（配乐）           │
│    ├ remove_bg     ├ video_edit     ├ sfx（音效）             │
│    └ ...           └ compose(ffmpeg)└ mix（混音）             │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Agent（智能体）

一个 Agent 是可保存、可复用、可分享的创作配置：

| 字段 | 说明 |
|---|---|
| `persona` | 系统人设（system prompt 片段），定义智能体的角色、语气、审美取向 |
| `skills[]` | 挂载的 SKILL id 列表（有序，靠前优先级更高） |
| `allowed_plugins[]` | Plugin 白名单（限定智能体能调用的能力，安全 + 聚焦） |
| `policy` | 运行策略：`max_steps`、`budget_limit`（积分上限）、`confirm_mode`（auto/checkpoint/step）、`default_aspect_ratio`、`style_lock` 等 |
| `scope` | 可见性：`system`(平台预置) / `tenant`(租户共享) / `private`(个人) |

**预置 Agent 示例**（平台随功能上线，即开即用）：

- 🛍️ **带货短视频导演** — 产品图 → 竖屏 15s 带货视频（含口播配音、字幕、贴片）
- 🖼️ **电商主图设计师** — 产品图 → 白底主图 / 场景图 / 促销图三件套
- 🎬 **解说视频制作人** — 文稿 → 分镜配图 → 视频 → AI 配音 → 字幕
- 🎨 **一图多风格** — 一张图 → N 种艺术风格变体
- 🔊 **有声故事机** — 文本故事 → 分段插图 + 分段 TTS 朗读 + 背景音乐

### 2.2 SKILL（技能）

SKILL 是本设计的灵魂——它把"人类专家的创作套路"编码成智能体可理解、可执行的结构化知识。**SKILL 不是代码，而是"带约束的方法论 + 推荐工具链"**。

一个 SKILL 的结构（详见 §5）：

```yaml
id: ecommerce-storyboard
name: 电商带货分镜法
category: 影视创作
description: 把一张产品图拆解为"痛点-展示-卖点-促单"四段式带货分镜
when_to_use: 用户要做产品带货/种草视频时
instructions: |
  你是资深电商短视频导演。收到产品图后：
  1. 先用 image.remove_bg + image.generate 生成 3~4 个使用场景图；
  2. 每个场景配一句口播文案，遵循"痛点→展示→卖点→促单"节奏；
  3. 用 video.image_to_video 让每个场景图动起来（运镜建议：推、摇、特写）；
  4. 调 audio.tts 生成口播，audio.music 配轻快 BGM；
  5. 最后 video.compose 顺序拼接 + 字幕。
  约束：竖屏 9:16；总时长 12~18s；口播语速偏快；禁用夸大功效词。
recommended_plugins: [image.remove_bg, image.generate, video.image_to_video, audio.tts, audio.music, video.compose]
inputs:
  - { key: product_image, type: image, required: true, label: 产品图 }
  - { key: selling_points, type: text, required: false, label: 卖点(可选) }
outputs:
  - { key: final_video, type: video, label: 带货成片 }
constraints:
  aspect_ratio: "9:16"
  max_duration_sec: 18
```

**SKILL 的三种来源**：

1. **平台预置**（`scope=system`）——由官方沉淀的高质量方法论。
2. **租户/个人自定义**——用户在 SKILL 编辑器里填 `instructions` + 选 `recommended_plugins` + 定 `constraints`，保存后可挂到任意 Agent。
3. **从成功 Run 反向沉淀**——某次 Run 效果好，一键"存为 SKILL"，把当时的规划轨迹提炼成 instructions（进阶特性，见 §12 路线图）。

**SKILL 组合**：一个 Agent 挂多个 SKILL 时，编排引擎把各 SKILL 的 `instructions` 合并进 system prompt，`recommended_plugins` 取并集，`constraints` 按"更严格者优先"合并（如两个 SKILL 各要求 9:16 与 16:9 时，以 Agent.policy 或用户输入裁决并提示冲突）。

### 2.3 Plugin（插件）

Plugin 是**原子能力**，一次 Plugin 调用 = 智能体的一次 function-calling = 一个 Step。每个 Plugin 声明标准的 **JSON Schema 入参**（供 LLM function-calling）、映射到一次 `gateway` 调用、声明计费项。详见 §4。

Plugin 三族与能力矩阵（✅现有 gateway 已支持 / 🟡需薄封装 / 🔴需新增集成）：

| 族 | Plugin | 底层 | 状态 |
|---|---|---|---|
| **image** | `image.generate`（文/图生图） | gateway `generate_image` | ✅ |
| | `image.edit`（局部编辑/inpaint，图生图带 mask/参考） | gateway `generate_image`(i2i) | ✅ |
| | `image.remove_bg`（抠图/去背景） | gateway（提示词+i2i 或专用） | 🟡 |
| | `image.upscale`（超分/放大） | gateway | 🟡 |
| | `image.variations`（多风格变体） | gateway `generate_image` 循环 | ✅ |
| **video** | `video.image_to_video`（图生视频，含首/尾帧、运镜） | gateway `hailuo/seedance/happyhorse_create` | ✅ |
| | `video.text_to_video`（文生视频） | gateway `seedance_create` | ✅ |
| | `video.video_to_video`（风格化重绘） | gateway `video2video_create`/`kling_omni_video2video` | ✅ |
| | `video.motion`（动作/运动控制） | gateway `motion_create`/`kling_motion_control_create` | ✅ |
| | `video.edit`（视频编辑） | gateway `video_edit_create` | ✅ |
| | `video.compose`（多片段 ffmpeg 拼接+字幕+贴片） | 现 drama `compose-final`（imageio-ffmpeg） | 🟡 |
| **audio** | `audio.tts`（文本转语音/配音） | 🔴 新增 gateway 音频集成 | 🔴 |
| | `audio.asr`（语音转字幕/时间轴） | 🔴 新增 | 🔴 |
| | `audio.music`（AI 配乐/BGM 生成） | 🔴 新增 | 🔴 |
| | `audio.sfx`（音效生成） | 🔴 新增 | 🔴 |
| | `audio.mix`（多轨混音：人声+BGM+音效，ffmpeg） | 🟡 ffmpeg 本地 | 🟡 |

> **音频分期**：一期落地 `image.*` 全部 + `video.*` 全部；二期落地 `audio.tts` + `audio.mix`（配音+混音，价值最高）；三期落地 `audio.asr` + `audio.music` + `audio.sfx`。详见 §9、§12。

---

## 3. 编排引擎（Orchestrator）—— 自主智能体执行范式

### 3.1 执行主循环（Agentic Loop）

编排引擎是一个 **LLM function-calling 主循环**，跑在后台任务里：

```
  组装 system prompt（persona + 合并后的 SKILL instructions + 约束 + 可用 Plugin 清单）
  组装 user message（用户目标 + 输入素材引用）
  loop（直到完成 / 达 max_steps / 超预算 / 用户中断）:
    ① LLM 推理 → 返回 (思考文本, 工具调用请求?)
    ② 若无工具调用且 LLM 声明"完成" → 收尾，产出最终 Artifact，break
    ③ 若有工具调用：
        a. 校验 Plugin 在 allowed_plugins 白名单内
        b. 校验/补全参数（对照 Plugin JSON Schema）
        c. 预算检查 + 扣费（deduct，租户级）
        d. 若 confirm_mode 命中该步 → 置 AWAITING_CONFIRMATION，暂停等用户确认
        e. 执行 Plugin（调 gateway；长任务走 create+poll）
        f. 产物落 MinIO → 生成 Artifact，回填到 LLM 的 tool result（含产物引用/可读描述）
        g. 失败 → 退款(recharge) + 把错误回填给 LLM，让它决定重试/换方案/放弃
    ④ 记录 AgentStep，更新 AgentRun.progress，continue
```

**关键设计点**：

- **工具结果回喂**：Plugin 产出图片/视频后，回给 LLM 的是**结构化描述 + Artifact 引用**（如 `{artifact_id, type:"image", key:"users/.../a.png", note:"已生成白底产品图"}`），必要时附**多模态回看**（把生成图作为 image input 让 LLM"看到"效果并决定下一步）。这让智能体能真正"看着结果做决策"。
- **上下文流转**：复用现有 `WorkflowService._inject_context` 思路——上一步产物自动进入下一步可引用的上下文槽。
- **模型**：编排大脑用 gateway 的文本/多模态模型（当前 `deepseek-v4-flash` 用于纯文本；涉及"看图决策"时需多模态模型——见 §7.4 依赖）。

### 3.2 三种确认模式（human-in-the-loop）

沿用现有 `StepStatus.AWAITING_CONFIRMATION`：

| `confirm_mode` | 行为 | 适用 |
|---|---|---|
| `auto` | 全自动，不打断，跑到底 | 信任智能体、追求快 |
| `checkpoint` | 仅在"关键节点"（如最终合成前、单步花费 > 阈值）暂停确认 | 默认，平衡 |
| `step` | 每步执行前都需用户点"继续/修改/跳过" | 精调、教学、调试 |

暂停时 `AgentRun.status = awaiting_confirmation`，前端弹出"当前计划 + 已产出预览 + 待执行动作"，用户可：**确认继续 / 编辑参数后继续 / 跳过此步 / 追加指令 / 终止**。

### 3.3 控制与安全边界

- **max_steps**：防止无限循环（默认 20）。
- **budget_limit**：Run 累计花费上限（积分），超限暂停并询问用户是否加预算。
- **allowed_plugins 白名单**：智能体无法调用白名单外的能力（即使 LLM 幻觉出工具名，也被引擎拒绝）。
- **超时**：单 Plugin 轮询超时（沿用现有 3s×N 上限）；整 Run 墙钟超时。
- **可中断/可续跑**：AgentRun 状态持久化于 DB，进程重启或用户刷新后可恢复（见 §7.4 已知限制）。
- **内容安全**：透传 gateway 的 `GatewayContentModerationError`，命中即该步失败并退款、向用户提示。

---

## 4. Plugin 规范（Plugin Contract）

### 4.1 Plugin 定义结构

每个 Plugin 是后端一个注册项（Python），对 LLM 暴露为一个 function-calling 工具：

```python
@register_plugin
class ImageGeneratePlugin(BasePlugin):
    name = "image.generate"
    family = "image"                       # image | video | audio
    label = "生成图片"
    description = "根据文本提示词生成图片，可选参考图做图生图"
    # 供 LLM function-calling 的 JSON Schema
    parameters_schema = {
        "type": "object",
        "properties": {
            "prompt":      {"type": "string", "description": "画面描述"},
            "reference_image": {"type": "string", "description": "可选，Artifact 引用或对象key，做图生图"},
            "aspect_ratio":{"type": "string", "enum": ["1:1","9:16","16:9"], "default": "1:1"},
            "model":       {"type": "string", "enum": ["wan","wan-pro"], "default": "wan"},
            "n":           {"type": "integer", "minimum": 1, "maximum": 4, "default": 1},
        },
        "required": ["prompt"],
    }
    output_type = "image"                  # image | video | audio | text
    is_long_running = False                # True 者走 create+poll
    def cost(self, params) -> int: ...     # 返回积分（对齐 models.py /pricing）
    async def execute(self, ctx, params) -> PluginResult: ...  # 调 gateway，落 MinIO，返回 Artifact
```

`BasePlugin.execute` 统一约定：

- 入参里的 Artifact 引用（上一步产物）由引擎解析为 MinIO key 或临时可读 URL 后传入。
- 长任务（video.* / audio.music 等）返回后由引擎负责 `gateway.*_poll` 轮询；Plugin 只暴露 `submit()` + `poll()` 两钩子。
- 产出统一封装 `PluginResult { artifact: Artifact, cost: int, raw_meta: dict }`。
- Plugin **不直接扣费**——扣费由引擎在调用前后统一做（对齐"router 层扣费"的现有约定，此处引擎即扣费层）。

### 4.2 Plugin 注册表

- 后端：`backend/app/plugins/registry.py` 维护 `name → PluginClass`；启动时自动发现 `backend/app/plugins/{image,video,audio}/*.py`。
- 对外：`GET /api/v1/plugins` 返回所有 Plugin 的 `{name, family, label, description, parameters_schema, output_type, cost_hint}`，供前端渲染"能力清单"与 SKILL 编辑器的 Plugin 选择器。
- 对 LLM：引擎按 Agent.allowed_plugins 过滤后，把 `parameters_schema` 转成 function-calling tools 列表注入。

### 4.3 Plugin ↔ gateway 映射（复用现有）

| Plugin | gateway 调用 | 备注 |
|---|---|---|
| `image.generate` / `image.edit` / `image.variations` | `generate_image(prompt, reference_image?, model)` | i2i 传 reference |
| `video.image_to_video` | `hailuo_create` / `seedance_create` / `happyhorse_create` + `video_poll` | 引擎选族由 SKILL/参数决定 |
| `video.text_to_video` | `seedance_create` + `seedance_poll` | |
| `video.video_to_video` | `video2video_create` / `kling_omni_video2video` + `kling_poll` | |
| `video.motion` | `motion_create` / `kling_motion_control_create` | |
| `video.edit` | `video_edit_create` | |
| `video.compose` | 本地 `imageio-ffmpeg`（复用 drama compose） | 拼接/字幕/转场 |
| `image.remove_bg` / `image.upscale` | gateway（需确认上游是否有专用端点，否则用 i2i 提示词方案） | 🟡待接口确认 |
| `audio.*` | 🔴 新增 `gateway` 音频方法（见 §9） | 分期 |

---

## 5. SKILL 规范（SKILL Contract）

### 5.1 数据结构

```jsonc
{
  "id": "ecommerce-storyboard",
  "name": "电商带货分镜法",
  "category": "影视创作",            // 图片创作 | 影视创作 | 音频创作 | 通用
  "icon": "clapperboard",
  "description": "…",
  "when_to_use": "…",               // 帮助智能体判断何时套用该技能
  "instructions": "…(核心：方法论 Prompt，注入 system)…",
  "recommended_plugins": ["image.remove_bg", "video.image_to_video", "audio.tts"],
  "inputs":  [{ "key":"product_image","type":"image","required":true,"label":"产品图" }],
  "outputs": [{ "key":"final_video","type":"video","label":"带货成片" }],
  "constraints": { "aspect_ratio":"9:16", "max_duration_sec":18, "forbidden_words":["根治","最"] },
  "few_shot": [ /* 可选：优质范例，提升智能体规划质量 */ ],
  "scope": "system",                // system | tenant | private
  "version": 3
}
```

### 5.2 SKILL 如何影响智能体

- `instructions` → 拼入 system prompt（多 SKILL 合并，带小标题分隔）。
- `recommended_plugins` → 与 Agent.allowed_plugins 取交集，作为"优先推荐工具"提示给 LLM（LLM 仍可在白名单内自由选）。
- `constraints` → 一部分注入 prompt（软约束，如禁词），一部分由引擎硬校验（如 aspect_ratio 强制、max_duration 截断）。
- `inputs` → 决定 Run 启动前需向用户收集哪些素材（前端动态渲染输入表单）。
- `few_shot` → 附加到 prompt，提升规划稳定性。

### 5.3 SKILL 编辑器（自定义）

用户自定义 SKILL 的 UI（复用现有 `src/data/*.ts` 模板卡片 + `OptionSelector` 模式）：

1. 基本信息（名称/分类/图标/描述/何时使用）。
2. **方法论编辑**：富文本/Markdown 写 `instructions`，右侧实时提示"可引用的 Plugin 名"。
3. **推荐 Plugin 多选**：从 `GET /plugins` 拉取，卡片勾选。
4. **输入/输出槽定义**：增删 `inputs`/`outputs`，选类型。
5. **约束**：宽高比、时长、禁词等表单。
6. **测试**：即时挂到一个临时 Agent 跑一次 dry-run（只规划不执行，展示智能体会怎么用这个 SKILL）。

---

## 6. 数据模型（新增表）

复用现有多租户/计费/存储体系，新增 4 张核心表 + 复用 `GenerationTask`。

### 6.1 `agents`（智能体定义）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` PK | int | |
| `agent_id` | uuid, unique | 对外标识 |
| `tenant_id` FK | int | 多租户隔离 |
| `user_id` FK | int | 创建者 |
| `name` | str | |
| `description` | str | |
| `avatar` | str | 头像/图标 |
| `persona` | Text | 系统人设 |
| `skill_ids` | JSON | 有序 SKILL id 列表 |
| `allowed_plugins` | JSON | Plugin 白名单 |
| `policy` | JSON | `{max_steps, budget_limit, confirm_mode, default_aspect_ratio, style_lock, model}` |
| `scope` | enum | system / tenant / private |
| `is_active` | bool | |
| `created_at/updated_at/deleted_at` | ts | 软删除 |

### 6.2 `skills`（技能定义）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` PK / `skill_id` uuid | | |
| `tenant_id` / `user_id` FK | | 隔离与归属（system 级 tenant_id 可空） |
| `name` `category` `icon` `description` `when_to_use` | str | |
| `instructions` | Text | 方法论 Prompt |
| `recommended_plugins` | JSON | |
| `inputs` `outputs` `constraints` `few_shot` | JSON | |
| `scope` | enum | system / tenant / private |
| `version` | int | 编辑即自增，Run 快照引用 |
| `created_at/updated_at/deleted_at` | ts | |

### 6.3 `agent_runs`（一次运行）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` PK / `run_id` uuid | | |
| `tenant_id` / `user_id` FK | | |
| `agent_id` FK | | 运行时 Agent |
| `agent_snapshot` | JSON | **快照**：Run 启动时的 persona/skills/allowed_plugins/policy（防定义变更污染历史 Run） |
| `goal` | Text | 用户目标（自然语言） |
| `inputs` | JSON | 用户提供的输入素材（Artifact/对象 key 引用） |
| `status` | enum | pending / planning / running / awaiting_confirmation / completed / failed / cancelled |
| `progress` | int | 0-100 |
| `current_step_index` | int | |
| `plan` | JSON | 智能体当前规划（可动态更新，供前端展示"计划") |
| `final_artifacts` | JSON | 最终产物引用列表 |
| `total_cost` | int | 累计扣费 |
| `error_message` | Text | |
| `created_at/updated_at/deleted_at` | ts | |

### 6.4 `agent_steps`（步骤 / 轨迹）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` PK | | |
| `run_id` FK | | |
| `step_index` | int | |
| `type` | enum | plan / tool_call / confirmation / summary |
| `plugin_name` | str | tool_call 时的 Plugin |
| `thought` | Text | LLM 思考文本（可展示，增强透明度） |
| `input_data` | JSON | Plugin 入参 |
| `output_data` | JSON | Plugin 产物引用 + 元数据 |
| `generation_task_id` | str | 关联 `GenerationTask.task_id`（长任务复用现有轮询） |
| `status` | enum | pending / processing / awaiting_confirmation / completed / failed / skipped |
| `cost` | int | 本步扣费 |
| `error_message` | Text | |
| `created_at/updated_at` | ts | |

> **Artifact 存储**：不单独建表，产物即 `agent_steps.output_data` 中的引用；长任务产物复用 `GenerationTask`（含 `result_path`/`result_url`），落 MinIO key `users/{uid}/agents/{run_id}/...`（新增 `StorageService.agent_artifact_key`）。最终成品可选"存入画廊"→ 复用 `GenerationTask.show_in_gallery`。

---

## 7. 后端 API 与实现

### 7.1 端点清单（新 router `agents.py`，前缀 `/api/v1/agents`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/plugins` | 列出所有 Plugin（能力清单，供前端/SKILL 编辑器） |
| GET | `/` | 列出可用 Agent（system + 本租户 + 个人） |
| POST | `/` | 创建自定义 Agent |
| GET | `/{agent_id}` | Agent 详情 |
| PUT | `/{agent_id}` | 更新 |
| DELETE | `/{agent_id}` | 软删除 |
| GET | `/skills` | 列出 SKILL |
| POST | `/skills` | 创建 SKILL |
| PUT/DELETE | `/skills/{skill_id}` | 更新/删除 |
| POST | `/skills/{skill_id}/dry-run` | 干跑：只规划不执行，返回智能体拟定计划 |
| POST | `/runs` | **启动一次 Run**（body: agent_id, goal, inputs）→ 返回 run_id，后台执行 |
| GET | `/runs/{run_id}` | **轮询 Run 状态**（含 plan、steps、progress、产物） |
| POST | `/runs/{run_id}/confirm` | 确认/编辑/跳过当前待确认步骤 |
| POST | `/runs/{run_id}/message` | 运行中追加指令（干预智能体） |
| POST | `/runs/{run_id}/cancel` | 终止 Run |
| GET | `/runs` | 历史 Run 列表 |

### 7.2 服务分层

```
api/v1/agents.py（router：鉴权、扣费预检查、启动后台任务、状态查询）
  → services/agent_orchestrator.py（AgentOrchestrator：主循环、LLM 调用、工具分发、确认/续跑）
      → plugins/registry.py + plugins/{image,video,audio}/*（Plugin 执行）
          → integrations/gateway/client.py（真实 AI 调用）
      → services/storage.py（Artifact 落 MinIO）
      → core/credits.py（deduct/recharge，租户级）
  → repositories/agent_repo.py（agents/skills/agent_runs/agent_steps 持久化）
```

### 7.3 执行机制（沿用 BackgroundTasks + 轮询）

- `POST /runs`：建 `AgentRun(status=pending)` 落库 → `background_tasks.add_task(orchestrator.run, run_id)` → 立即返回 run_id。
- 后台函数自开新 DB session（`AsyncSessionLocal`，对齐现有模式）跑主循环；每步更新 `agent_steps`/`agent_runs` 并 commit。
- 长任务 Plugin（video/audio）：引擎内 `gateway.*_create` → 循环 `*_poll`，并写 `agent_steps.generation_task_id` 关联，前端既可轮询 Run 也可复用 `GenerationTask` 查询。
- 前端 `GET /runs/{run_id}` 每 2~3s 轮询（对齐 render_pipeline 模式），拿 plan/steps/progress/产物增量渲染；断点续传：打开未完成 Run 自动恢复轮询。

### 7.4 已知限制与演进（务必知会）

| 限制 | 影响 | 演进 |
|---|---|---|
| **BackgroundTasks 进程内、无持久化队列** | 后端重启，正在跑的 Run 中断；无并发/限流控制。Agent Run 比单次生成更长、更贵，风险被放大 | Run 状态已持久化于 DB → 可实现**重启后扫描 `running` Run 续跑**；中长期建议引入 Celery/RQ + Redis（本期不做，但表结构已为续跑预留） |
| **多模态"看图决策"依赖** | 智能体"看着产物做下一步"需多模态 LLM；当前 gateway 文本模型是 deepseek-v4-flash | 需确认 gateway 是否提供多模态输入的 chat；否则一期降级为"仅凭产物元数据/描述决策"（不回看图像） |
| **无音频能力** | audio.* 全新 | §9 分期新增 |
| **租户状态极薄** | 前端 `tenant.store` 仅 1 字段 | Agent/SKILL 的 tenant 隔离在后端强约束即可，前端无需大改 |

---

## 8. 前端设计

### 8.1 新增路由与导航

- 新路由 `/agent-studio`（`AgentStudio.tsx`），`isAuthenticated` 门控，Sidebar 加入口（badge `New`）。
- 子视图：`gallery`(Agent 广场) / `agent`(Agent 详情&自定义) / `skills`(SKILL 库&编辑器) / `run`(运行工作台) / `runs`(历史)。

### 8.2 关键界面

**A. Agent 广场（gallery）**
卡片网格（复用 `ProjectCard`/模板卡片风格）：预置 Agent + 我的 Agent，"使用" / "自定义副本" / "新建 Agent"。

**B. Agent 编辑器**
- 人设编辑 + SKILL 挑选（从 SKILL 库多选，拖动排序）+ Plugin 白名单勾选 + 策略表单（max_steps/预算/确认模式/宽高比）。
- 复用 `OptionSelector` / `AssetPickerModal` 交互风格。

**C. SKILL 库 & 编辑器**
§5.3 所述，卡片选择 + 方法论编辑 + dry-run 测试。

**D. 运行工作台（run）—— 核心界面**
仿 OmniWeaverPro 的手风琴 + AIWorkbench 的聊天式，融合成"**目标输入 + 实时执行轨迹**"：

```
┌───────────────┬─────────────────────────────────────┐
│  左：配置       │  右：执行流（Timeline）              │
│  · 选中 Agent   │  ┌ 用户目标气泡                      │
│  · 输入素材槽   │  │ 🧠 规划：智能体拟定 5 步计划(可展开) │
│    (按 SKILL    │  │ ① image.remove_bg ✅ [产物缩略图]   │
│     .inputs     │  │ ② image.generate ✅ [3张场景图]     │
│     动态渲染)   │  │ ③ video.image_to_video ⏳ 62%       │
│  · 确认模式     │  │ ⏸ 待确认：合成前预览 [确认][改][跳] │
│  · 预算显示     │  │ ④ audio.tts …                       │
│  [▶ 开始创作]   │  │ 🎬 最终成品 [播放] [存画廊] [下载]  │
│                │  └ [追加指令输入框]                   │
└───────────────┴─────────────────────────────────────┘
```

- 复用 `render.service` 轮询模式 → 新增 `agent.service.ts`（startRun/pollRun/confirmStep/sendMessage/cancelRun）。
- 每个 Step 卡片展示 `thought`（可折叠）+ Plugin 名 + 入参摘要 + 产物预览 + 花费，透明可审计。
- 断点续传：打开未完成 Run 自动恢复轮询（复用 OmniWeaverPro `useEffect` 恢复模式）。

### 8.3 状态管理

- Run 运行态用页面本地 `useState`（对齐现有复杂业务不入 store 的约定）。
- Agent/SKILL 列表可选轻量缓存；余额沿用 `credit.store`。

---

## 9. 音频能力集成（全量设计，分期实现）

### 9.1 gateway 新增音频方法（后端）

`integrations/gateway/client.py` 扩展（或新增 `integrations/audio/` 薄封装）：

| 方法 | 能力 | 上游 | 期次 |
|---|---|---|---|
| `tts_create/poll` | 文本转语音（多音色、语速、情感） | 需接入 TTS 供应商（如平台已有网关的语音模型，否则新增） | 二期 |
| `asr_transcribe` | 语音转文字 + 时间轴（生成字幕 srt） | ASR 供应商 | 三期 |
| `music_create/poll` | 文本/情绪 → BGM | 音乐生成模型 | 三期 |
| `sfx_create` | 描述 → 音效 | 音效模型 | 三期 |

> **依赖确认项**：需产品/供应商侧确认可用的音频上游（TTS/ASR/音乐）。若网关暂无，二期可先接第三方（火山语音/Azure/ElevenLabs 等）。本文档不锁定供应商，仅定义 Plugin 契约。

### 9.2 audio Plugin 契约

- `audio.tts` — in: `{text, voice, speed, emotion, format}` → out: audio。计费按字符/秒。
- `audio.asr` — in: `{audio_ref}` → out: text + `subtitles(srt)`。
- `audio.music` — in: `{mood, duration, genre}` → out: audio（长任务）。
- `audio.sfx` — in: `{description, duration}` → out: audio。
- `audio.mix` — in: `{tracks:[{ref, gain, start}], duration}` → out: audio（本地 ffmpeg 多轨混音）。

### 9.3 影视+音频协同（video.compose 增强）

`video.compose` 增支持"视频轨 + 音频轨（配音/BGM/音效）+ 字幕轨"的 ffmpeg 合成，使"解说视频/带货视频/有声故事"闭环。二期随 `audio.tts` 一并落地混音路径。

---

## 10. 计费与多租户

- **粒度**：沿用**租户级** `Credit.balance`（一租户一条）。Run 内每个 Plugin Step 独立扣费，`agent_steps.cost` 累加进 `agent_runs.total_cost`。
- **流程**（对齐现有"预检查→deduct→失败 recharge"）：
  1. `POST /runs` 前用 `policy.budget_limit` 与余额做**准入检查**（余额不足直接 402）。
  2. 每个 Step 执行前 `check_sufficient_credits` → `deduct(tenant_id, step_cost, "agent:{run_id} step:{i} {plugin}")`。
  3. Step 失败 → `recharge` 退回该步积分；引擎把失败回喂 LLM 决定重试/换路（重试再次扣费）。
  4. Run 累计花费达 `budget_limit` → 暂停 `awaiting_confirmation`，询问是否加预算。
- **透明度**：`Transaction.description` 带 run_id/step 便于对账；前端运行工作台实时显示"本次已花费 / 预算上限"。
- **定价**：Plugin.cost 对齐 `models.py /pricing`（wan 图 40、wan-pro 80、Hailuo 视频 150…）；音频类定价新增。
- **隔离**：agents/skills 按 `tenant_id` + `scope` 过滤；`system` 级对所有租户可见只读；`private` 仅创建者可见。

---

## 11. 安全、审计与内容合规

- **Plugin 白名单硬校验**：LLM 幻觉出的工具/越权工具被引擎拒绝。
- **参数校验**：所有 Plugin 入参对照 JSON Schema 校验，Artifact 引用校验归属（防跨用户/租户读取他人产物）。
- **内容审核**：透传 `GatewayContentModerationError`，命中即失败+退款+提示。
- **注入防护**：SKILL.instructions 与用户 goal 均视为**数据**注入 prompt；对用户可自定义 SKILL 的租户，`system` 级 Plugin/能力不因 SKILL 文本被越权（白名单是硬边界，不受 prompt 影响）。
- **审计**：`agent_steps` 完整记录 thought/入参/产物/花费，可回溯；Run 可导出轨迹。
- **速率/滥用**：`max_steps` + `budget_limit` + Run 墙钟超时三重刹车，防止自主循环烧钱。

---

## 12. 分期路线图

| 期次 | 范围 | 交付 |
|---|---|---|
| **P0 · 地基** | 数据模型(agents/skills/agent_runs/agent_steps)、Plugin 注册表、`GET /plugins`、编排引擎主循环（纯文本决策+工具调用）、扣费/退款、`image.*` + `video.*` Plugin（复用 gateway） | 能跑"图片+影视"纯自主 Run；1~2 个预置 Agent（电商主图、一图多风格） |
| **P1 · 前端 & 体验** | AgentStudio 全套 UI（广场/编辑器/SKILL 库/运行工作台/历史）、确认模式、断点续传、dry-run | 用户可自定义 Agent+SKILL 并可视化运行 |
| **P2 · 音频闭环** | `audio.tts` + `audio.mix` + `video.compose` 音轨增强、多模态"看图决策"（若 gateway 支持） | 带货/解说视频闭环（含配音） |
| **P3 · 进阶** | `audio.asr/music/sfx`、"从成功 Run 沉淀 SKILL"、Run 模板分享、租户 Agent 市场、（可选）引入 Celery 队列 | 完整音频 + 生态化 |

---

## 13. 验收标准（P0/P1 核心）

1. 用户选"电商主图设计师" Agent，上传一张产品图，点开始 → 智能体自主完成"抠图→白底主图→2 张场景图"，全部落 MinIO，可在工作台预览、下载、存画廊。
2. 运行工作台实时展示智能体的**规划（plan）+ 逐步轨迹（thought/plugin/产物/花费）**，进度可轮询、刷新可续。
3. 用户可新建自定义 SKILL（填 instructions + 选 Plugin + 定约束），挂到自定义 Agent，dry-run 能看到智能体拟定的计划。
4. `confirm_mode=checkpoint` 时，最终合成前正确暂停，用户确认后继续。
5. 每步正确扣费、失败正确退款；超 `budget_limit` 正确暂停询问。
6. Plugin 白名单外的能力，即使诱导也无法被调用。

---

## 14. 关键文件清单（落地指引）

**后端（新增）**
- `backend/app/models/agent.py`（Agent/Skill/AgentRun/AgentStep）
- `backend/app/repositories/agent_repo.py`
- `backend/app/services/agent_orchestrator.py`（编排主循环，参考 `workflow_service.py`）
- `backend/app/plugins/base.py` · `registry.py` · `image/*.py` · `video/*.py` · `audio/*.py`
- `backend/app/api/v1/agents.py`（注册到 `main.py`）
- `backend/app/integrations/gateway/client.py`（P2 加音频方法）
- `backend/app/services/storage.py`（加 `agent_artifact_key`）
- Alembic 迁移：新增 4 表

**前端（新增）**
- `frontend/src/pages/AgentStudio.tsx`（参考 `OmniWeaverPro.tsx` 骨架）
- `frontend/src/services/agent.service.ts`（参考 `render.service.ts` 轮询）
- `frontend/src/components/agent/*`（AgentCard / AgentEditor / SkillEditor / RunTimeline / StepCard / ConfirmDialog）
- `frontend/src/data/preset-agents.ts` · `preset-skills.ts`（预置数据，参考 `effectsData.ts`）
- `frontend/src/types/agent.types.ts`
- `frontend/src/App.tsx`（加 `/agent-studio` 路由）· `components/layout/Sidebar.tsx`（加入口）

**复用（不改或薄改）**
- 编排原语参考：`services/workflow_service.py`（`_inject_context`、步骤状态机、AWAITING_CONFIRMATION）
- 前端骨架参考：`pages/OmniWeaverPro.tsx`（STEPS/AccordionStep/轮询/续传）、`pages/AIWorkbench.tsx`（聊天式）
- 计费：`core/credits.py`（deduct/recharge，租户级）
- 存储：`services/storage.py`
- 长任务轮询：`gateway` 各 `*_poll` + `GenerationTask`

---

## 附录 A：端到端示例（带货短视频）

```
用户目标："把这张产品图做成 15 秒竖屏带货短视频，突出'便携、快充'两个卖点"
Agent："带货短视频导演"（SKILL: 电商带货分镜法 + 竖屏节奏法 + 口播配音法）
输入：product.jpg

智能体规划（plan）：
  1. image.remove_bg(product.jpg) → 透明产品图
  2. image.generate ×3（户外/办公/旅行场景, 9:16, 参考透明产品图）→ 场景图×3
  3. video.image_to_video ×3（推镜/特写, 各 5s）→ 片段×3
  4. audio.tts（口播文案："出门再也不怕没电…", 语速快, 亲和音色）→ 配音
  5. audio.music（轻快电子 BGM, 15s）→ BGM
  6. video.compose（3 片段 + 配音 + BGM + 字幕, 9:16, 15s）→ 成片.mp4

执行：逐步扣费、产物落 MinIO、checkpoint 在第 6 步前暂停预览确认
产出：final.mp4（可下载/存画廊/一键抖音发布 —— 复用现有 douyin 集成）
```

*(P0/P1 无音频，示例第 4/5 步降级为无配音/无 BGM，或跳过；P2 补齐。)*

---

*文档版本 v1.0 · 2026-07-06 · 待评审*
