/**
 * AgentStudio —— 自定义智能体工作室（P1-c）。
 *
 * 三个 Tab：
 *   智能体 —— 列表 / 新建 / 编辑 / 删除 / 运行 / dry-run
 *   技能   —— 列表 / 新建 / 编辑 / 删除
 *   运行   —— 发起新 Run + 历史列表 + 选中 Run 详情（轮询 / 人工确认 / 产物预览）
 *
 * 后端：app/api/v1/agents.py（P0~P1-b 全部 LIVE）。前端仅装配，不引全局 store。
 */
import { useEffect, useState } from 'react'
import {
  Bot, Sparkles, ListVideo, Plus, Play, FlaskConical, Pencil, Trash2, Loader2, Lock, X, Copy, Wand2,
} from 'lucide-react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  agentService, type AgentDef, type SkillDef, type PluginSpec, type AgentRun, type DryRunResult,
} from '../services/agent.service'
import { polishPrompt } from '../services/prompt.service'
import AgentEditor from '../components/agent/AgentEditor'
import SkillEditor from '../components/agent/SkillEditor'
import RunDetail from '../components/agent/RunDetail'
import RunInputsForm from '../components/agent/RunInputsForm'

type Tab = 'agents' | 'skills' | 'runs'

const CONFIRM_MODES = [
  { value: 'auto', label: '自动（不挂起）' },
  { value: 'checkpoint', label: '检查点（高花费步挂起）' },
  { value: 'step', label: '逐步（每步挂起）' },
]

// 运行目标占位样例：示范「怎么写目标」，也可作为 AI 润色的模板起点。
const GOAL_SAMPLE =
  '为一款便携保温杯制作一条竖屏带货短视频：突出「6 小时保温、一键弹盖、大容量」卖点，' +
  '面向通勤白领，画面简洁有质感，时长约 15 秒。'

const RUN_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-300',
  planning: 'bg-blue-500/20 text-blue-300',
  running: 'bg-blue-500/20 text-blue-300',
  awaiting_confirmation: 'bg-amber-500/20 text-amber-300',
  completed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-gray-600/30 text-gray-400',
}

export default function AgentStudio() {
  useDocumentTitle('智能体工作室')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('agents')

  const [agents, setAgents] = useState<AgentDef[]>([])
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [plugins, setPlugins] = useState<PluginSpec[]>([])
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 编辑器
  const [editingAgent, setEditingAgent] = useState<AgentDef | null | undefined>(undefined) // undefined=关闭, null=新建
  const [editingSkill, setEditingSkill] = useState<SkillDef | null | undefined>(undefined)

  // 运行 Tab
  const [selectedRun, setSelectedRun] = useState<string>('')
  const [runAgentKey, setRunAgentKey] = useState('default')
  const [runGoal, setRunGoal] = useState('')
  const [runFieldValues, setRunFieldValues] = useState<Record<string, any>>({})
  const [runConfirmMode, setRunConfirmMode] = useState<'' | 'auto' | 'checkpoint' | 'step'>('')
  const [starting, setStarting] = useState(false)
  const [goalPolishing, setGoalPolishing] = useState(false)
  const [dryGoalPolishing, setDryGoalPolishing] = useState(false)

  // dry-run
  const [dryAgentKey, setDryAgentKey] = useState('default')
  const [dryGoal, setDryGoal] = useState('')
  const [dryResult, setDryResult] = useState<DryRunResult | null>(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [dryOpen, setDryOpen] = useState(false)

  const skillName = (id: string) => skills.find((s) => s.skill_id === id)?.name || id

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [a, s, p, r] = await Promise.all([
        agentService.listAgents(),
        agentService.listSkills(),
        agentService.listPlugins(),
        agentService.listRuns(),
      ])
      setAgents(a); setSkills(s); setPlugins(p); setRuns(r)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadAll() }, [])

  const reloadRuns = async () => {
    try { setRuns(await agentService.listRuns()) } catch { /* ignore */ }
  }

  // ── Agent 操作 ─────────────────────────────────────────────────────────────
  const canEdit = (a: AgentDef) => a.scope !== 'system'

  const handleDeleteAgent = async (a: AgentDef) => {
    if (!confirm(`删除智能体「${a.name}」？`)) return
    try { await agentService.deleteAgent(a.agent_id); setAgents((xs) => xs.filter((x) => x.agent_id !== a.agent_id)) }
    catch (e: any) { alert(e?.response?.data?.detail || '删除失败') }
  }

  const handleRunAgent = (a: AgentDef) => {
    setRunAgentKey(agentKeyOf(a))
    setRunFieldValues({})
    setTab('runs')
    setSelectedRun('')
  }
  const handleDryAgent = (a: AgentDef) => {
    setDryAgentKey(agentKeyOf(a))
    setDryResult(null)
    setDryOpen(true)
  }

  // ── Skill 操作 ─────────────────────────────────────────────────────────────
  const canEditSkill = (s: SkillDef) => s.scope !== 'system'
  const handleDeleteSkill = async (s: SkillDef) => {
    if (!confirm(`删除技能「${s.name}」？`)) return
    try { await agentService.deleteSkill(s.skill_id); setSkills((xs) => xs.filter((x) => x.skill_id !== s.skill_id)) }
    catch (e: any) { alert(e?.response?.data?.detail || '删除失败') }
  }

  // ── 发起 Run ───────────────────────────────────────────────────────────────
  const runAgent = agents.find((a) => agentKeyOf(a) === runAgentKey)
  const runFields = runAgent?.input_schema || []

  // AI 润色运行目标：为空时以样例模板为起点生成，有内容则润色。
  const polishGoal = async () => {
    const base = runGoal.trim() || GOAL_SAMPLE
    setGoalPolishing(true)
    setError('')
    try {
      const polished = await polishPrompt(base, 'goal')
      if (polished) setRunGoal(polished)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'AI 润色失败，请稍后重试')
    } finally {
      setGoalPolishing(false)
    }
  }

  const startRun = async () => {
    if (!runGoal.trim()) { setError('目标（goal）不能为空'); return }
    // 按 input_schema 校验必填 + 组装 inputs
    const inputs: Record<string, any> = {}
    for (const f of runFields) {
      const v = runFieldValues[f.key]
      const empty = v === undefined || v === null || v === ''
      if (f.required && empty) {
        setError(`请填写必填项：${f.label || f.key}`)
        return
      }
      if (!empty) inputs[f.key] = v
    }
    setStarting(true)
    setError('')
    try {
      const { run_id } = await agentService.createRun({
        goal: runGoal.trim(),
        inputs: Object.keys(inputs).length ? inputs : null,
        agent_key: runAgentKey,
        confirm_mode: runConfirmMode || undefined,
      })
      setRunGoal(''); setRunFieldValues({})
      setSelectedRun(run_id)
      await reloadRuns()
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '发起失败')
    } finally {
      setStarting(false)
    }
  }

  // ── dry-run ────────────────────────────────────────────────────────────────
  const polishDryGoal = async () => {
    const base = dryGoal.trim() || GOAL_SAMPLE
    setDryGoalPolishing(true)
    try {
      const polished = await polishPrompt(base, 'goal')
      if (polished) setDryGoal(polished)
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || 'AI 润色失败，请稍后重试')
    } finally {
      setDryGoalPolishing(false)
    }
  }

  const doDryRun = async () => {
    if (!dryGoal.trim()) return
    setDryRunning(true)
    setDryResult(null)
    try {
      const res = await agentService.dryRun({ goal: dryGoal.trim(), agent_key: dryAgentKey })
      setDryResult(res)
    } catch (e: any) {
      setDryResult({ plan_text: '', planned_tool_calls: [], allowed_plugins: [], estimated_cost: 0 } as any)
      alert(e?.response?.data?.detail || 'dry-run 失败')
    } finally {
      setDryRunning(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 flex flex-col bg-[#0d0d0f] min-w-0 overflow-y-auto px-4 md:px-8 py-4 md:py-6">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="w-6 h-6 text-pink-400" />
            <h1 className="text-xl md:text-2xl font-bold text-gray-100">智能体工作室</h1>
          </div>
          <p className="text-sm text-gray-500 mb-4">自定义智能体（技能 × 插件）：编排、运行、人工确认。</p>

          {/* Tabs */}
          <div className="flex gap-1 mb-5 border-b border-gray-800/60">
            <TabBtn active={tab === 'agents'} onClick={() => setTab('agents')} icon={Bot} label="智能体" />
            <TabBtn active={tab === 'skills'} onClick={() => setTab('skills')} icon={Sparkles} label="技能" />
            <TabBtn active={tab === 'runs'} onClick={() => setTab('runs')} icon={ListVideo} label="运行" />
          </div>

          {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
          {loading && <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" />加载中...</div>}

          {/* ── 智能体 Tab ── */}
          {!loading && tab === 'agents' && (
            <div>
              <div className="flex justify-end mb-3">
                <button onClick={() => setEditingAgent(null)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white">
                  <Plus className="w-4 h-4" />新建智能体
                </button>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {agents.map((a) => (
                  <div key={a.agent_id} className="rounded-xl border border-gray-800/60 bg-[#16161a] p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                      <Bot className="w-4 h-4 text-pink-400 shrink-0" />
                      <span className="font-medium text-gray-100 truncate">{a.name}</span>
                      {a.scope === 'system' && <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-500"><Lock className="w-3 h-3" />系统</span>}
                      {a.scope === 'tenant' && <span className="ml-auto text-[10px] text-blue-400">租户</span>}
                    </div>
                    {a.description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{a.description}</p>}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(a.allowed_plugins || []).map((p) => (
                        <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{p}</span>
                      ))}
                    </div>
                    {(a.skill_ids || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {a.skill_ids.map((id) => (
                          <span key={id} className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-300">{skillName(id)}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-auto pt-2 flex items-center gap-1">
                      <button onClick={() => handleRunAgent(a)} title="运行"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-green-500/15 text-green-300 hover:bg-green-500/25">
                        <Play className="w-3.5 h-3.5" />运行
                      </button>
                      <button onClick={() => handleDryAgent(a)} title="dry-run 预估"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-blue-500/15 text-blue-300 hover:bg-blue-500/25">
                        <FlaskConical className="w-3.5 h-3.5" />预估
                      </button>
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => setEditingAgent(a)} disabled={!canEdit(a)} title="编辑"
                          className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30">
                          <Pencil className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                        <button onClick={() => handleDeleteAgent(a)} disabled={!canEdit(a)} title="删除"
                          className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30">
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 技能 Tab ── */}
          {!loading && tab === 'skills' && (
            <div>
              <div className="flex justify-end mb-3">
                <button onClick={() => setEditingSkill(null)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white">
                  <Plus className="w-4 h-4" />新建技能
                </button>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {skills.map((s) => (
                  <div key={s.skill_id} className="rounded-xl border border-gray-800/60 bg-[#16161a] p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="w-4 h-4 text-pink-400 shrink-0" />
                      <span className="font-medium text-gray-100 truncate">{s.name}</span>
                      {s.scope === 'system' && <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-500"><Lock className="w-3 h-3" />系统</span>}
                      {s.scope === 'tenant' && <span className="ml-auto text-[10px] text-blue-400">租户</span>}
                    </div>
                    {s.category && <span className="text-[10px] text-gray-500 mb-1">{s.category}</span>}
                    {s.description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{s.description}</p>}
                    <p className="text-[11px] text-gray-600 line-clamp-3 mb-2">{s.instructions}</p>
                    <div className="mt-auto pt-2 flex items-center gap-1">
                      <span className="text-[10px] text-gray-600">v{s.version}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => setEditingSkill(s)}
                          title={canEditSkill(s) ? '编辑' : '查看 / 另存为副本'}
                          className="p-1.5 rounded-lg hover:bg-white/10">
                          {canEditSkill(s)
                            ? <Pencil className="w-3.5 h-3.5 text-gray-400" />
                            : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                        </button>
                        <button onClick={() => handleDeleteSkill(s)} disabled={!canEditSkill(s)} title="删除"
                          className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30">
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 运行 Tab ── */}
          {!loading && tab === 'runs' && (
            <div className="grid lg:grid-cols-[360px_1fr] gap-4">
              {/* 左：发起 + 历史 */}
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-800/60 bg-[#16161a] p-4">
                  <h3 className="text-sm font-semibold text-gray-200 mb-3">发起新 Run</h3>
                  <label className="block mb-2">
                    <span className="block text-xs text-gray-400 mb-1">智能体</span>
                    <select className="input" value={runAgentKey}
                      onChange={(e) => { setRunAgentKey(e.target.value); setRunFieldValues({}) }}>
                      {agents.map((a) => <option key={a.agent_id} value={agentKeyOf(a)}>{a.name}</option>)}
                    </select>
                  </label>
                  <label className="block mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">目标 Goal</span>
                      <button type="button" onClick={polishGoal} disabled={goalPolishing}
                        title={runGoal.trim() ? '让 AI 润色当前目标' : '以样例为起点，让 AI 生成一个目标'}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-60">
                        {goalPolishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        {goalPolishing ? '润色中...' : (runGoal.trim() ? 'AI 润色' : 'AI 生成样例')}
                      </button>
                    </div>
                    <textarea className="input min-h-[110px] text-xs leading-relaxed" value={runGoal}
                      onChange={(e) => setRunGoal(e.target.value)} placeholder={GOAL_SAMPLE} />
                  </label>
                  {runFields.length > 0 && (
                    <div className="mb-2">
                      <span className="block text-xs text-gray-400 mb-1">输入素材</span>
                      <RunInputsForm fields={runFields} values={runFieldValues} onChange={setRunFieldValues} />
                    </div>
                  )}
                  <label className="block mb-3">
                    <span className="block text-xs text-gray-400 mb-1">确认模式（不选=用智能体默认）</span>
                    <select className="input" value={runConfirmMode} onChange={(e) => setRunConfirmMode(e.target.value as any)}>
                      <option value="">（智能体默认）</option>
                      {CONFIRM_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </label>
                  <button onClick={startRun} disabled={starting}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-60">
                    {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}发起
                  </button>
                </div>

                <div className="rounded-xl border border-gray-800/60 bg-[#16161a] p-4">
                  <h3 className="text-sm font-semibold text-gray-200 mb-3">历史 Run</h3>
                  <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                    {runs.length === 0 && <p className="text-xs text-gray-600">暂无</p>}
                    {runs.map((r) => (
                      <button key={r.run_id} onClick={() => setSelectedRun(r.run_id)}
                        className={`w-full text-left rounded-lg px-3 py-2 border transition-colors ${
                          selectedRun === r.run_id ? 'border-pink-500/60 bg-pink-500/5' : 'border-gray-800/60 hover:border-gray-600'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${RUN_STATUS_STYLE[r.status] || 'bg-gray-500/20 text-gray-300'}`}>{r.status}</span>
                          <span className="text-[10px] text-gray-500 ml-auto">花费 {r.total_cost ?? 0}</span>
                        </div>
                        <p className="text-xs text-gray-300 mt-1 line-clamp-2">{r.goal}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 右：Run 详情 */}
              <div className="rounded-xl border border-gray-800/60 bg-[#16161a] p-4 min-h-[300px]">
                {selectedRun
                  ? <RunDetail runId={selectedRun} onChanged={reloadRuns} />
                  : <div className="flex items-center justify-center h-full text-sm text-gray-600">选择或发起一个 Run 查看详情</div>}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 编辑器弹窗 */}
      {editingAgent !== undefined && (
        <AgentEditor
          agent={editingAgent}
          skills={skills}
          plugins={plugins}
          onClose={() => setEditingAgent(undefined)}
          onSaved={(saved) => {
            setAgents((xs) => {
              const i = xs.findIndex((x) => x.agent_id === saved.agent_id)
              if (i >= 0) { const c = [...xs]; c[i] = saved; return c }
              return [saved, ...xs]
            })
            setEditingAgent(undefined)
          }}
        />
      )}
      {editingSkill !== undefined && (
        <SkillEditor
          skill={editingSkill}
          plugins={plugins}
          onClose={() => setEditingSkill(undefined)}
          onSaved={(saved) => {
            setSkills((xs) => {
              const i = xs.findIndex((x) => x.skill_id === saved.skill_id)
              if (i >= 0) { const c = [...xs]; c[i] = saved; return c }
              return [saved, ...xs]
            })
            setEditingSkill(undefined)
          }}
        />
      )}

      {/* dry-run 面板 */}
      {dryOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-[#16161a] rounded-2xl border border-gray-800/60 p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-100">
                <FlaskConical className="w-5 h-5 text-blue-400" />干跑预估（dry-run）
              </h2>
              <button onClick={() => setDryOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">只让智能体规划一次，返回拟调用工具与预估花费。<b className="text-gray-400">不建 Run、不执行、不扣费。</b></p>
            <label className="block mb-2">
              <span className="block text-xs text-gray-400 mb-1">智能体</span>
              <select className="input" value={dryAgentKey} onChange={(e) => setDryAgentKey(e.target.value)}>
                {agents.map((a) => <option key={a.agent_id} value={agentKeyOf(a)}>{a.name}</option>)}
              </select>
            </label>
            <label className="block mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">目标 Goal</span>
                <button type="button" onClick={polishDryGoal} disabled={dryGoalPolishing}
                  title={dryGoal.trim() ? '让 AI 润色当前目标' : '以样例为起点，让 AI 生成一个目标'}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-60">
                  {dryGoalPolishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  {dryGoalPolishing ? '润色中...' : (dryGoal.trim() ? 'AI 润色' : 'AI 生成样例')}
                </button>
              </div>
              <textarea className="input min-h-[110px] text-xs leading-relaxed" value={dryGoal}
                onChange={(e) => setDryGoal(e.target.value)} placeholder={GOAL_SAMPLE} />
            </label>
            <button onClick={doDryRun} disabled={dryRunning || !dryGoal.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/80 text-white hover:bg-blue-500 disabled:opacity-60 mb-4">
              {dryRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}开始预估
            </button>

            {dryResult && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">拟调用 {dryResult.planned_tool_calls.length} 个工具</span>
                  <span className="text-amber-300">预估合计花费 {dryResult.estimated_cost}</span>
                </div>
                {dryResult.plan_text && <p className="text-xs text-gray-400 whitespace-pre-wrap bg-black/30 rounded-lg p-2">{dryResult.plan_text}</p>}
                {dryResult.planned_tool_calls.map((t, i) => (
                  <div key={i} className="rounded-lg border border-gray-800/60 bg-[#101014] p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-200 font-medium">{t.label}</span>
                      <span className="text-gray-500">({t.name})</span>
                      <span className="ml-auto text-amber-300">花费 {t.cost}</span>
                    </div>
                    <pre className="mt-1 bg-black/30 rounded px-2 py-1 overflow-x-auto text-[10px] text-gray-300 whitespace-pre-wrap break-all">
                      {JSON.stringify(t.args, null, 2)}
                    </pre>
                  </div>
                ))}
                {dryResult.planned_tool_calls.length === 0 && !dryRunning &&
                  <p className="text-xs text-gray-600">智能体本轮未规划任何工具调用。</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// agent_key 即 agent_id（后端 load_runtime 按 agent_id 匹配；系统默认体 agent_id 就是 "default"）
function agentKeyOf(a: AgentDef): string {
  return a.agent_id
}

function TabBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: any; label: string
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
        active ? 'border-pink-500 text-pink-300' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
      <Icon className="w-4 h-4" />{label}
    </button>
  )
}
