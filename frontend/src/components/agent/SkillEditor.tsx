/**
 * SkillEditor —— 新建 / 编辑技能的弹窗表单。字段对齐后端 SkillBody。
 *
 * 技能 = 纯「方法论」：instructions（核心，会被引用它的智能体合并进 system prompt）
 * + when_to_use（何时套用）+ constraints（画幅/时长）+ recommended_plugins（推荐插件）。
 * 技能本身不单独运行，也不定义「用户输入」——那属于智能体层（Agent.input_schema）。
 * inputs/outputs/few_shot 后端列保留，此处保存为空数组，不破坏历史数据。
 */
import { useEffect, useState } from 'react'
import { X, Loader2, Sparkles, Wand2, Info } from 'lucide-react'
import {
  agentService, type SkillDef, type SkillBody, type PluginSpec,
} from '../../services/agent.service'
import { polishPrompt } from '../../services/prompt.service'

interface Props {
  skill?: SkillDef | null            // 传入=编辑，否则=新建
  plugins: PluginSpec[]
  onClose: () => void
  onSaved: (s: SkillDef) => void
}

const RATIOS = ['', '16:9', '9:16', '1:1']

// 技能说明占位样例：既是「怎么写」的示范，也可作为 AI 润色的模板起点。
const INSTRUCTIONS_SAMPLE = `你是一位电商带货短视频分镜师。当用户需要为某件商品制作带货短视频时套用本技能。

工作方法：
1. 先明确商品卖点与目标人群，提炼 1 个核心记忆点。
2. 按「开场吸睛 → 痛点代入 → 卖点展示 → 促单行动」拆成 4 段分镜。
3. 每段给出画面描述、镜头运动、时长建议，画面描述要具体到光线、构图、氛围。
4. 需要出图时，把画面描述写得完整可直接生成。

产出要求：
- 分镜编号清晰，每段不超过 3 秒；
- 整体风格统一、节奏紧凑，突出商品；
- 避免夸大功效或违规词。`


export default function SkillEditor({ skill, plugins, onClose, onSaved }: Props) {
  const isSystem = skill?.scope === 'system'   // 系统内置：只读查看 + 另存为私有副本

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [icon, setIcon] = useState('')
  const [description, setDescription] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [instructions, setInstructions] = useState('')
  const [recommended, setRecommended] = useState<string[]>([])
  const [aspectRatio, setAspectRatio] = useState('')
  const [maxDuration, setMaxDuration] = useState<string>('')
  const [scope, setScope] = useState<'private' | 'tenant'>('private')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [polishing, setPolishing] = useState(false)

  useEffect(() => {
    if (skill) {
      const sys = skill.scope === 'system'
      setName(sys ? `${skill.name || ''} 副本` : (skill.name || ''))
      setCategory(skill.category || '')
      setIcon(skill.icon || '')
      setDescription(skill.description || '')
      setWhenToUse(skill.when_to_use || '')
      setInstructions(skill.instructions || '')
      setRecommended(skill.recommended_plugins || [])
      const c = skill.constraints || {}
      setAspectRatio(c.aspect_ratio || c.ratio || '')
      setMaxDuration(c.max_duration != null ? String(c.max_duration) : '')
      // 系统技能不能改本体，副本默认落为私有
      setScope(sys ? 'private' : (skill.scope === 'tenant' ? 'tenant' : 'private'))
    }
  }, [skill])

  const toggle = (v: string) =>
    setRecommended((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]))

  // AI 润色技能说明：为空时以样例模板作为起点，让 AI 据此生成一版可用说明。
  const handlePolish = async () => {
    const base = instructions.trim() || INSTRUCTIONS_SAMPLE
    setPolishing(true)
    setError('')
    try {
      const polished = await polishPrompt(base, 'skill')
      if (polished) setInstructions(polished)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'AI 润色失败，请稍后重试')
    } finally {
      setPolishing(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim() || !instructions.trim()) {
      setError('名称与技能说明（instructions）不能为空')
      return
    }
    const constraints: Record<string, any> = {}
    if (aspectRatio) constraints.aspect_ratio = aspectRatio
    if (maxDuration.trim() && !Number.isNaN(Number(maxDuration))) {
      constraints.max_duration = Number(maxDuration)
    }

    setSaving(true)
    setError('')
    const body: SkillBody = {
      name: name.trim(),
      instructions: instructions.trim(),
      category: category.trim() || null,
      icon: icon.trim() || null,
      description: description.trim() || null,
      when_to_use: whenToUse.trim() || null,
      recommended_plugins: recommended,
      inputs: [], outputs: [], few_shot: [],
      constraints, scope,
    }
    try {
      // 系统内置技能只读：保存时不改本体，而是为当前用户另存为私有副本（fork）。
      const saved = (skill && !isSystem)
        ? await agentService.updateSkill(skill.skill_id, body)
        : await agentService.createSkill(body)
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
            <Sparkles className="w-5 h-5 text-pink-400" />
            {isSystem ? '查看系统技能（另存为副本）' : (skill ? '编辑技能' : '新建技能')}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        {isSystem && (
          <div className="mb-3 flex gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 leading-relaxed">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              这是系统内置技能，不可直接修改。你可在此查看内容并按需调整，保存后将
              <b className="text-amber-100">另存为你的私有副本</b>（不影响系统技能本体）。
            </span>
          </div>
        )}

        <div className="mb-4 flex gap-2 text-xs text-gray-400 bg-blue-500/[0.07] border border-blue-500/20 rounded-lg px-3 py-2 leading-relaxed">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <span>
            技能是一套「方法论」，本身不单独运行。需被智能体在其「引用技能」中选用后，
            运行时由智能体依据「何时使用」自主套用其说明。这里不定义用户输入——那属于智能体的「运行输入」。
          </span>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="名称 *">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：电商带货分镜法" />
            </Field>
            <Field label="分类（可选）">
              <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="如：分镜" />
            </Field>
            <Field label="图标（可选）">
              <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="emoji / 名称" />
            </Field>
          </div>

          <Field label="简介（可选）">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明" />
          </Field>

          <Field label="何时使用 When to use（可选）">
            <input className="input" value={whenToUse} onChange={(e) => setWhenToUse(e.target.value)}
              placeholder="如：需要为商品制作带货短视频时。供引用本技能的智能体判断何时套用。" />
          </Field>

          <Field label="技能说明 Instructions *">
            <div className="flex items-center justify-end mb-1.5">
              <button type="button" onClick={handlePolish} disabled={polishing}
                title={instructions.trim() ? '让 AI 润色当前技能说明' : '以样例模板为起点，让 AI 生成一版技能说明'}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-60">
                {polishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {polishing ? '润色中...' : (instructions.trim() ? 'AI 润色' : 'AI 生成样例')}
              </button>
            </div>
            <textarea className="input min-h-[140px] font-mono text-xs" value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={INSTRUCTIONS_SAMPLE} />
            <p className="text-[11px] text-gray-600 mt-1">
              留空时点「AI 生成样例」将以上方占位样例为模板生成；已填写则对当前内容润色。
            </p>
          </Field>

          <Field label={`推荐 Plugin（多选，${recommended.length} 选中）`}>
            <div className="flex flex-wrap gap-2">
              {plugins.map((p) => (
                <button key={p.name} type="button" onClick={() => toggle(p.name)}
                  className={chip(recommended.includes(p.name))}>
                  {p.label}<span className="ml-1 opacity-50">({p.name})</span>
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="约束：画幅比 aspect_ratio">
              <select className="input" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                {RATIOS.map((r) => <option key={r} value={r}>{r || '（不限制）'}</option>)}
              </select>
            </Field>
            <Field label="约束：最大时长 max_duration（秒）">
              <input type="number" min={0} className="input" value={maxDuration}
                onChange={(e) => setMaxDuration(e.target.value)} placeholder="留空=不限制" />
            </Field>
          </div>

          <Field label="可见范围">
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value as any)}>
              <option value="private">仅自己</option>
              <option value="tenant">本租户共享</option>
            </select>
          </Field>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/10">取消</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-60 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}{isSystem ? '另存为副本' : '保存'}
          </button>
        </div>
      </div>
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
