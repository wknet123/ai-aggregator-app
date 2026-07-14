/**
 * AgentEditor —— 新建 / 编辑自定义智能体的弹窗表单。字段对齐后端 AgentBody。
 * system scope 的智能体只读（后端 403），调用方应避免以只读 agent 打开本编辑器。
 *
 * 智能体 = 编排层：身份（人设）+ 能力（引用技能 / 圈定插件）+ 运行输入（input_schema）
 * + 执行策略（policy）。技能只提供「方法论」，本编辑器负责把它们组装成可运行的智能体。
 */
import { useEffect, useState } from 'react'
import { X, Loader2, Bot, Wand2 } from 'lucide-react'
import {
  agentService, type AgentDef, type AgentBody, type SkillDef, type PluginSpec,
  type InputField,
} from '../../services/agent.service'
import { polishPrompt } from '../../services/prompt.service'
import InputFieldsEditor from './InputFieldsEditor'

interface Props {
  agent?: AgentDef | null            // 传入=编辑，否则=新建
  skills: SkillDef[]
  plugins: PluginSpec[]
  onClose: () => void
  onSaved: (a: AgentDef) => void
}

const CONFIRM_MODES = [
  { value: 'auto', label: '自动（不挂起）' },
  { value: 'checkpoint', label: '检查点（高花费步挂起）' },
  { value: 'step', label: '逐步（每步挂起）' },
]

// 人设占位样例：既示范「怎么写」，也可作为 AI 润色的模板起点。
const PERSONA_SAMPLE = `你是一位电商带货短视频创作智能体，服务于需要快速产出带货素材的商家。

角色定位：懂商品卖点、懂平台调性的短视频操盘手。
核心目标：根据用户提供的商品信息与素材，产出可直接使用的带货图片/短视频。
工作方式：
- 先理解商品卖点与目标人群，再决定用什么画面表达；
- 需要出图时把画面描述写得具体完整；需要成片时先想清楚分镜节奏；
- 善用已配置的技能方法论，按其「何时使用」在合适环节套用。
行为边界：忠于商品事实，不夸大功效、不使用违规词，风格统一克制。`


export default function AgentEditor({ agent, skills, plugins, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [avatar, setAvatar] = useState('')
  const [persona, setPersona] = useState('')
  const [skillIds, setSkillIds] = useState<string[]>([])
  const [allowedPlugins, setAllowedPlugins] = useState<string[]>([])
  const [inputSchema, setInputSchema] = useState<InputField[]>([])
  const [maxSteps, setMaxSteps] = useState(6)
  const [budgetLimit, setBudgetLimit] = useState(500)
  const [confirmThreshold, setConfirmThreshold] = useState(1)
  const [confirmMode, setConfirmMode] = useState<'auto' | 'checkpoint' | 'step'>('auto')
  const [scope, setScope] = useState<'private' | 'tenant'>('private')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [polishing, setPolishing] = useState(false)

  useEffect(() => {
    if (agent) {
      setName(agent.name || '')
      setDescription(agent.description || '')
      setAvatar(agent.avatar || '')
      setPersona(agent.persona || '')
      setSkillIds(agent.skill_ids || [])
      setAllowedPlugins(agent.allowed_plugins || [])
      setInputSchema(agent.input_schema || [])
      const p = agent.policy || {}
      setMaxSteps(p.max_steps ?? 6)
      setBudgetLimit(p.budget_limit ?? 500)
      setConfirmThreshold(p.confirm_cost_threshold ?? 1)
      setConfirmMode(p.confirm_mode ?? 'auto')
      setScope(agent.scope === 'tenant' ? 'tenant' : 'private')
    }
  }, [agent])

  const toggle = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]

  // AI 润色人设：为空时以样例模板为起点，让 AI 据此生成一版人设。
  const handlePolish = async () => {
    const base = persona.trim() || PERSONA_SAMPLE
    setPolishing(true)
    setError('')
    try {
      const polished = await polishPrompt(base, 'agent')
      if (polished) setPersona(polished)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'AI 润色失败，请稍后重试')
    } finally {
      setPolishing(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim() || !persona.trim()) {
      setError('名称与人设（persona）不能为空')
      return
    }
    // 输入字段：key 必填、唯一、英文
    const keys = inputSchema.map((f) => f.key.trim())
    if (keys.some((k) => !k)) {
      setError('每个输入字段都需要填写 key')
      return
    }
    if (new Set(keys).size !== keys.length) {
      setError('输入字段的 key 不能重复')
      return
    }
    if (keys.some((k) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(k))) {
      setError('输入字段 key 需以字母开头，仅含字母/数字/下划线')
      return
    }
    setSaving(true)
    setError('')
    const body: AgentBody = {
      name: name.trim(),
      persona: persona.trim(),
      description: description.trim() || null,
      avatar: avatar.trim() || null,
      skill_ids: skillIds,
      allowed_plugins: allowedPlugins,
      policy: {
        max_steps: maxSteps,
        budget_limit: budgetLimit,
        confirm_cost_threshold: confirmThreshold,
        confirm_mode: confirmMode,
      },
      input_schema: inputSchema.map((f) => ({ ...f, label: f.label.trim() || f.key })),
      scope,
    }
    try {
      const saved = agent
        ? await agentService.updateAgent(agent.agent_id, body)
        : await agentService.createAgent(body)
      onSaved(saved)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#16161a] rounded-2xl border border-gray-800/60 p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-100">
            <Bot className="w-5 h-5 text-pink-400" />
            {agent ? '编辑智能体' : '新建智能体'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="space-y-5">
          {/* ① 身份 */}
          <Section title="① 身份" desc="这个智能体是谁。人设会作为系统提示词，定义其角色、目标与工作方式。">
            <div className="grid grid-cols-2 gap-3">
              <Field label="名称 *">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：带货分镜助手" />
              </Field>
              <Field label="头像 URL（可选）">
                <input className="input" value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://..." />
              </Field>
            </div>

            <Field label="简介（可选）">
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明用途" />
            </Field>

            <Field label="人设 Persona *">
              <div className="flex items-center justify-end mb-1.5">
                <button type="button" onClick={handlePolish} disabled={polishing}
                  title={persona.trim() ? '让 AI 润色当前人设' : '以样例模板为起点，让 AI 生成一版人设'}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-60">
                  {polishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {polishing ? '润色中...' : (persona.trim() ? 'AI 润色' : 'AI 生成样例')}
                </button>
              </div>
              <textarea className="input min-h-[120px] font-mono text-xs" value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder={PERSONA_SAMPLE} />
              <p className="text-[11px] text-gray-600 mt-1">
                留空时点「AI 生成样例」将以上方占位样例为模板生成；已填写则对当前内容润色。
              </p>
            </Field>
          </Section>

          {/* ② 能力：引用技能 + 圈定插件 */}
          <Section title="② 能力" desc="智能体如何使用技能与插件——这是「引用关系」。">
            <Field label={`引用技能（多选，${skillIds.length} 选中）`}>
              <div className="flex flex-wrap gap-2">
                {skills.length === 0 && <span className="text-xs text-gray-500">暂无技能，可到「技能」页新建</span>}
                {skills.map((s) => (
                  <button key={s.skill_id} type="button"
                    onClick={() => setSkillIds((a) => toggle(a, s.skill_id))}
                    className={chip(skillIds.includes(s.skill_id))}>
                    {s.name}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-600 mt-1">
                选中的技能会把其「方法论说明」合并进本智能体的系统提示词；技能推荐的插件仍需在下方「可用插件」勾选后才能被调用。
              </p>
            </Field>

            <Field label={`可用插件（多选，${allowedPlugins.length} 选中）`}>
              <div className="flex flex-wrap gap-2">
                {plugins.map((p) => (
                  <button key={p.name} type="button"
                    onClick={() => setAllowedPlugins((a) => toggle(a, p.name))}
                    className={chip(allowedPlugins.includes(p.name))}>
                    {p.label}<span className="ml-1 opacity-50">({p.name})</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-600 mt-1">
                硬白名单——运行时智能体只能调用这里勾选的插件（未勾选的即使技能推荐也不会执行）。
              </p>
            </Field>
          </Section>

          {/* ③ 运行输入 */}
          <Section title="③ 运行输入" desc="发起运行时，让用户填写/上传哪些素材（含图片上传）。技能不含此项。">
            <InputFieldsEditor value={inputSchema} onChange={setInputSchema} />
          </Section>

          {/* 引用 / 调用关系预览 */}
          <div className="rounded-lg border border-gray-800/60 bg-white/[0.03] px-3 py-2.5 text-xs text-gray-400 leading-relaxed space-y-1">
            <div>
              <span className="text-gray-300 font-medium">配置引用：</span>
              本智能体 → 引用 <span className="text-pink-300">{skillIds.length}</span> 个技能（方法论）
              ＋ 圈定 <span className="text-purple-300">{allowedPlugins.length}</span> 个插件（能力）
            </div>
            <div>
              <span className="text-gray-300 font-medium">运行调用：</span>
              用户填写输入（{inputSchema.length ? inputSchema.map((f) => f.label || f.key).join(' / ') : '仅目标 Goal'}）
              <span className="mx-1">→</span>技能方法论注入系统提示
              <span className="mx-1">→</span>LLM 自主决定套用哪个技能、调用哪个插件
              <span className="mx-1">→</span><span className="text-emerald-300">产出图片 / 视频</span>
            </div>
          </div>

          {/* ④ 执行策略 */}
          <Section title="④ 执行策略" desc="运行时的步数、预算与人工确认——技能不含此项。">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="最大步数">
                <input type="number" min={1} className="input" value={maxSteps}
                  onChange={(e) => setMaxSteps(Number(e.target.value))} />
              </Field>
              <Field label="预算上限">
                <input type="number" min={0} className="input" value={budgetLimit}
                  onChange={(e) => setBudgetLimit(Number(e.target.value))} />
              </Field>
              <Field label="确认花费阈值">
                <input type="number" min={0} className="input" value={confirmThreshold}
                  onChange={(e) => setConfirmThreshold(Number(e.target.value))} />
              </Field>
              <Field label="确认模式">
                <select className="input" value={confirmMode}
                  onChange={(e) => setConfirmMode(e.target.value as any)}>
                  {CONFIRM_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
            </div>

            <Field label="可见范围">
              <select className="input" value={scope} onChange={(e) => setScope(e.target.value as any)}>
                <option value="private">仅自己</option>
                <option value="tenant">本租户共享</option>
              </select>
            </Field>
          </Section>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/10">取消</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-60 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}保存
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-800/60 bg-white/[0.02] p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        {desc && <p className="text-[11px] text-gray-500 mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

const chip = (active: boolean) =>
  `px-2.5 py-1 rounded-full text-xs border transition-colors ${
    active
      ? 'bg-pink-500/20 border-pink-500/60 text-pink-200'
      : 'bg-white/5 border-gray-700 text-gray-300 hover:border-gray-500'
  }`
