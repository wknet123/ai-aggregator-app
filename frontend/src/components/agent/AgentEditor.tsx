/**
 * AgentEditor —— 新建 / 编辑自定义智能体的弹窗表单。字段对齐后端 AgentBody。
 * system scope 的智能体只读（后端 403），调用方应避免以只读 agent 打开本编辑器。
 */
import { useEffect, useState } from 'react'
import { X, Loader2, Bot } from 'lucide-react'
import {
  agentService, type AgentDef, type AgentBody, type SkillDef, type PluginSpec,
} from '../../services/agent.service'

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

export default function AgentEditor({ agent, skills, plugins, onClose, onSaved }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [avatar, setAvatar] = useState('')
  const [persona, setPersona] = useState('')
  const [skillIds, setSkillIds] = useState<string[]>([])
  const [allowedPlugins, setAllowedPlugins] = useState<string[]>([])
  const [maxSteps, setMaxSteps] = useState(6)
  const [budgetLimit, setBudgetLimit] = useState(500)
  const [confirmThreshold, setConfirmThreshold] = useState(1)
  const [confirmMode, setConfirmMode] = useState<'auto' | 'checkpoint' | 'step'>('auto')
  const [scope, setScope] = useState<'private' | 'tenant'>('private')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (agent) {
      setName(agent.name || '')
      setDescription(agent.description || '')
      setAvatar(agent.avatar || '')
      setPersona(agent.persona || '')
      setSkillIds(agent.skill_ids || [])
      setAllowedPlugins(agent.allowed_plugins || [])
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

  const handleSave = async () => {
    if (!name.trim() || !persona.trim()) {
      setError('名称与人设（persona）不能为空')
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#16161a] rounded-2xl border border-gray-800/60 p-6"
        onClick={(e) => e.stopPropagation()}
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

        <div className="space-y-4">
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
            <textarea className="input min-h-[120px] font-mono text-xs" value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="系统提示词：这个智能体的角色、目标、工作方式..." />
          </Field>

          <Field label={`技能（多选，${skillIds.length} 选中）`}>
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
          </Field>

          <Field label={`可用 Plugin（多选，${allowedPlugins.length} 选中）`}>
            <div className="flex flex-wrap gap-2">
              {plugins.map((p) => (
                <button key={p.name} type="button"
                  onClick={() => setAllowedPlugins((a) => toggle(a, p.name))}
                  className={chip(allowedPlugins.includes(p.name))}>
                  {p.label}<span className="ml-1 opacity-50">({p.name})</span>
                </button>
              ))}
            </div>
          </Field>

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
