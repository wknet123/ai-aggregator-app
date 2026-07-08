/**
 * SkillEditor —— 新建 / 编辑技能的弹窗表单。字段对齐后端 SkillBody。
 * instructions 是核心（会被合并进 Agent persona）。constraints 用结构化字段
 * （aspect_ratio / max_duration，对齐 executor._enforce_constraints 认的键）；
 * inputs/outputs/few_shot 一期用 JSON textarea 兜底，带解析校验。
 */
import { useEffect, useState } from 'react'
import { X, Loader2, Sparkles } from 'lucide-react'
import {
  agentService, type SkillDef, type SkillBody, type PluginSpec,
} from '../../services/agent.service'

interface Props {
  skill?: SkillDef | null            // 传入=编辑，否则=新建
  plugins: PluginSpec[]
  onClose: () => void
  onSaved: (s: SkillDef) => void
}

const RATIOS = ['', '16:9', '9:16', '1:1']

export default function SkillEditor({ skill, plugins, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [icon, setIcon] = useState('')
  const [description, setDescription] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [instructions, setInstructions] = useState('')
  const [recommended, setRecommended] = useState<string[]>([])
  const [aspectRatio, setAspectRatio] = useState('')
  const [maxDuration, setMaxDuration] = useState<string>('')
  const [inputsJson, setInputsJson] = useState('[]')
  const [outputsJson, setOutputsJson] = useState('[]')
  const [fewShotJson, setFewShotJson] = useState('[]')
  const [scope, setScope] = useState<'private' | 'tenant'>('private')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (skill) {
      setName(skill.name || '')
      setCategory(skill.category || '')
      setIcon(skill.icon || '')
      setDescription(skill.description || '')
      setWhenToUse(skill.when_to_use || '')
      setInstructions(skill.instructions || '')
      setRecommended(skill.recommended_plugins || [])
      const c = skill.constraints || {}
      setAspectRatio(c.aspect_ratio || c.ratio || '')
      setMaxDuration(c.max_duration != null ? String(c.max_duration) : '')
      setInputsJson(JSON.stringify(skill.inputs || [], null, 2))
      setOutputsJson(JSON.stringify(skill.outputs || [], null, 2))
      setFewShotJson(JSON.stringify(skill.few_shot || [], null, 2))
      setScope(skill.scope === 'tenant' ? 'tenant' : 'private')
    }
  }, [skill])

  const toggle = (v: string) =>
    setRecommended((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]))

  const handleSave = async () => {
    if (!name.trim() || !instructions.trim()) {
      setError('名称与技能说明（instructions）不能为空')
      return
    }
    let inputs: any[], outputs: any[], fewShot: any[]
    try {
      inputs = JSON.parse(inputsJson || '[]')
      outputs = JSON.parse(outputsJson || '[]')
      fewShot = JSON.parse(fewShotJson || '[]')
    } catch (e: any) {
      setError('inputs/outputs/few_shot 必须是合法 JSON 数组：' + (e?.message || ''))
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
      inputs, outputs, few_shot: fewShot,
      constraints, scope,
    }
    try {
      const saved = skill
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#16161a] rounded-2xl border border-gray-800/60 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-100">
            <Sparkles className="w-5 h-5 text-pink-400" />
            {skill ? '编辑技能' : '新建技能'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

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

          <Field label="何时使用（可选）">
            <input className="input" value={whenToUse} onChange={(e) => setWhenToUse(e.target.value)} placeholder="适用场景描述" />
          </Field>

          <Field label="技能说明 Instructions *">
            <textarea className="input min-h-[140px] font-mono text-xs" value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="会被合并进智能体 persona 的具体方法论 / 步骤 / 约束..." />
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

          <details className="rounded-lg border border-gray-800/60 p-3">
            <summary className="text-xs text-gray-400 cursor-pointer">高级：inputs / outputs / few_shot（JSON）</summary>
            <div className="grid md:grid-cols-3 gap-3 mt-3">
              <Field label="inputs (JSON)">
                <textarea className="input min-h-[90px] font-mono text-xs" value={inputsJson}
                  onChange={(e) => setInputsJson(e.target.value)} />
              </Field>
              <Field label="outputs (JSON)">
                <textarea className="input min-h-[90px] font-mono text-xs" value={outputsJson}
                  onChange={(e) => setOutputsJson(e.target.value)} />
              </Field>
              <Field label="few_shot (JSON)">
                <textarea className="input min-h-[90px] font-mono text-xs" value={fewShotJson}
                  onChange={(e) => setFewShotJson(e.target.value)} />
              </Field>
            </div>
          </details>

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
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}保存
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
