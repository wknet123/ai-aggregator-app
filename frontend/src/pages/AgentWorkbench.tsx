/**
 * AgentWorkbench —— 智能体工作台（plan-first 单画布，重构自三 Tab 的 AgentStudio）。
 *
 * 一屏三区：
 *   左 AgentRail   —— 模板卡 + 我的智能体（选中=当前编排对象）；新建/编辑走 slide-over(AgentEditor)。
 *   中 PlanCanvas  —— GoalBar(目标主角) → 生成计划(dry-run 只读预览) → 执行 → 内嵌 RunDetail。
 *   底 历史抽屉    —— 可折叠的历史 Run 列表。
 *
 * 语义(8a)：发起前的计划仅为「预估·可参考」，不照单执行；真正的改参/跳过在执行中的确认闸门。
 * 故工作台执行默认 confirm_mode='step'，让「控制生成步骤」真正兑现。
 * 复用：agent.service、AgentEditor、RunDetail(hideGoal)、RunInputsForm、polishPrompt。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bot, Plus, Play, FlaskConical, Pencil, Loader2, Wand2, Lock,
  Sparkles, ChevronDown, ChevronRight, History, RotateCcw, Images, Users, Clapperboard,
} from 'lucide-react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { dramaService } from '../services/drama.service'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  agentService, type AgentDef, type SkillDef, type PluginSpec,
  type AgentRun, type DryRunResult, type ModelOption,
} from '../services/agent.service'
import { polishPrompt } from '../services/prompt.service'
import AgentEditor from '../components/agent/AgentEditor'
import RunDetail from '../components/agent/RunDetail'
import RunInputsForm from '../components/agent/RunInputsForm'
import ResultGallery, { type WorkItem } from '../components/agent/ResultGallery'
import { googleService } from '../services/google.service'
import AICharacterPickerModal from '../components/agent/AICharacterPickerModal'

const CONFIRM_MODES = [
  { value: 'step', label: '逐步确认（每步可改参/跳过）' },
  { value: 'checkpoint', label: '检查点（仅高花费步挂起）' },
  { value: 'auto', label: '自动（不挂起，一路跑完）' },
]

// 各模板智能体的示范 goal（v1 用前端常量承载，不改 schema；key = agent_id）。
const TEMPLATE_GOALS: Record<string, string> = {
  default:
    '为一款便携保温杯生成一张竖屏商品主图：突出「6 小时保温、一键弹盖、大容量」卖点，画面简洁有质感。',
  'sys-ecom-shortvideo':
    '为一款便携保温杯制作一条 15 秒竖屏带货短视频：痛点开场→产品展示→卖点特写→使用场景→促单收尾，面向通勤白领。',
  'sys-product-hero':
    '为一支无线蓝牙耳机精修一张电商主图：纯色背景、突出产品质感与细节、留出标题文案空间，比例 1:1。',
  'sys-image-to-video':
    '把这张商品静态图转成一段 5 秒动态展示视频：镜头缓慢环绕、光影流动，风格高级克制。',
  'sys-storyboard-script':
    '为一款便携保温杯写一条带货短视频的分镜脚本：给出每个镜头的画面描述、时长与口播文案，总时长约 20 秒。',
}

const RUN_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-300',
  planning: 'bg-blue-500/20 text-blue-300',
  running: 'bg-blue-500/20 text-blue-300',
  awaiting_confirmation: 'bg-amber-500/20 text-amber-300',
  completed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-gray-600/30 text-gray-400',
}

export default function AgentWorkbench() {
  useDocumentTitle('智能体工作台')
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [feeding, setFeeding] = useState(false)

  const [agents, setAgents] = useState<AgentDef[]>([])
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [plugins, setPlugins] = useState<PluginSpec[]>([])
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 当前编排对象
  const [agentKey, setAgentKey] = useState('default')
  // 目标 + 输入 + 确认模式
  const [goal, setGoal] = useState('')
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({})
  const [confirmMode, setConfirmMode] = useState<'step' | 'checkpoint' | 'auto'>('step')
  const [moreOpen, setMoreOpen] = useState(false)
  const [polishing, setPolishing] = useState(false)

  // 模型选择（按需求+单价）：全部候选 + 用户为各能力选定的 model
  const [modelOptions, setModelOptions] = useState<Record<string, ModelOption[]>>({})
  const [modelPrefs, setModelPrefs] = useState<Record<string, string>>({})

  // 成果作品（与画廊同源：我的作品里来源为智能体的产物）
  const [galleryWorks, setGalleryWorks] = useState<WorkItem[]>([])
  const loadGalleryWorks = async () => {
    try {
      const [imgs, vids] = await Promise.all([
        googleService.getHistory('image', 80),
        googleService.getHistory('video', 80),
      ])
      const all = [...(imgs || []), ...(vids || [])]
        .filter((w: any) => typeof w.model_id === 'string' && w.model_id.startsWith('agent:'))
        .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
      setGalleryWorks(all as WorkItem[])
    } catch { /* ignore */ }
  }

  // 计划（dry-run 只读预览）
  const [plan, setPlan] = useState<DryRunResult | null>(null)
  const [planning, setPlanning] = useState(false)

  // 执行
  const [runId, setRunId] = useState('')
  const [runStatus, setRunStatus] = useState<AgentRun['status'] | ''>('')
  const [starting, setStarting] = useState(false)

  // slide-over 编辑器（undefined=关闭, null=新建, agent=编辑）
  const [editingAgent, setEditingAgent] = useState<AgentDef | null | undefined>(undefined)
  // 历史抽屉 / 成果画廊 / 角色库
  const [historyOpen, setHistoryOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [charPickerOpen, setCharPickerOpen] = useState(false)

  // 引用 AI 角色：把角色描述追加进目标，供智能体在生成时保持该角色形象。
  const insertCharacter = (desc: string) => {
    setGoal((g) => {
      const sep = g.trim() ? '\n' : ''
      return `${g.trim()}${sep}参考角色 —— ${desc}`
    })
    setCharPickerOpen(false)
  }

  // 把分镜脚本文本投喂到 OmniWeaver：建项目→写 episodes_data.script_text→跳转并自动打开。
  const feedToOmniWeaver = async (scriptText: string, title: string) => {
    if (!scriptText.trim()) { setError('没有可用的脚本文本'); return }
    setFeeding(true); setError('')
    try {
      const proj = await dramaService.createProject({
        name: title?.slice(0, 40) || '智能体脚本短剧',
        aspect_ratio: '9:16',
      })
      await dramaService.updateProject(proj.project_id, {
        episodes_data: {
          episodes: [{ episode: 1, title: title?.slice(0, 40) || '第一集', script_text: scriptText, shots: [] }],
        } as any,
      })
      navigate('/omni-weaver', { state: { openProjectId: proj.project_id } })
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '投喂 OmniWeaver 失败')
    } finally {
      setFeeding(false)
    }
  }

  // 复用某产物的目标：回填 GoalBar + 切智能体（若被锁定则忽略）。
  const reuseGoal = (g: string, ak: string) => {
    if (locked) return
    const a = agents.find((x) => x.agent_id === ak)
    if (a) { setAgentKey(a.agent_id); setFieldValues({}) }
    setGoal(g)
    setPlan(null); setRunId(''); setRunStatus('')
    setGalleryOpen(false)
  }

  const loadAll = async () => {
    setLoading(true); setError('')
    try {
      const [a, s, p, r] = await Promise.all([
        agentService.listAgents(),
        agentService.listSkills(),
        agentService.listPlugins(),
        agentService.listRuns(),
      ])
      setAgents(a); setSkills(s); setPlugins(p); setRuns(r)
      if (a.length && !a.some((x) => x.agent_id === agentKey)) setAgentKey(a[0].agent_id)
      try { setModelOptions(await agentService.listModelOptions()) } catch { /* 可选能力，失败忽略 */ }
      loadGalleryWorks()
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadAll() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const reloadRuns = async () => {
    try { setRuns(await agentService.listRuns()) } catch { /* ignore */ }
    loadGalleryWorks()   // Run 状态变化时刷新成果（新产物完成即出现）
  }

  const systemAgents = useMemo(() => agents.filter((a) => a.scope === 'system'), [agents])
  const myAgents = useMemo(() => agents.filter((a) => a.scope !== 'system'), [agents])
  const currentAgent = agents.find((a) => a.agent_id === agentKey) || null
  const runFields = currentAgent?.input_schema || []

  const agentName = (key: string) => agents.find((a) => a.agent_id === key)?.name || key

  // 首屏成果速览：与成果画廊同源（我的作品中来源为智能体的产物）。
  const showcaseWorks = galleryWorks

  // 当前查看的 Run（来自历史列表；用于判断是否可投喂脚本）。
  const currentRun = runs.find((r) => r.run_id === runId) || null
  // 是否是"文本脚本类"产出：已完成、无媒体产物、但有计划摘要文本。
  const scriptText = (currentRun?.plan?.summary as string) || ''
  const canFeedScript = !!currentRun && currentRun.status === 'completed'
    && !(currentRun.final_artifacts && currentRun.final_artifacts.length > 0)
    && !!scriptText.trim()

  // 历史运行按智能体分组（保持各组内原有时间倒序）。
  const groupedRuns = useMemo(() => {
    const m = new Map<string, AgentRun[]>()
    for (const r of runs) {
      const arr = m.get(r.agent_key) || []
      arr.push(r)
      m.set(r.agent_key, arr)
    }
    return Array.from(m.entries())
  }, [runs])

  // 执行中（含挂起待确认）锁定设计器：禁止切换智能体 / 改目标 / 改设置 / 重新生成计划。
  const ACTIVE_STATUS = ['pending', 'planning', 'running', 'awaiting_confirmation']
  const locked = !!runId && ACTIVE_STATUS.includes(runStatus as string)

  // 选中一个智能体：不预填目标——示范文案仅作为 goal 输入框的 placeholder 提示。
  const pickAgent = (a: AgentDef, _prefill = false) => {
    if (locked) return
    setAgentKey(a.agent_id)
    setPlan(null); setRunId(''); setRunStatus('')
    setFieldValues({})
  }

  const polishGoal = async () => {
    const base = goal.trim() || TEMPLATE_GOALS[agentKey] || ''
    if (!base) return
    setPolishing(true); setError('')
    try {
      const polished = await polishPrompt(base, 'goal')
      if (polished) setGoal(polished)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'AI 润色失败，请稍后重试')
    } finally {
      setPolishing(false)
    }
  }

  // 按 input_schema 校验必填并组装 inputs（返回 null 表示校验失败）
  const buildInputs = (): Record<string, any> | null => {
    const inputs: Record<string, any> = {}
    for (const f of runFields) {
      const v = fieldValues[f.key]
      const empty = v === undefined || v === null || v === ''
      if (f.required && empty) { setError(`请填写必填项：${f.label || f.key}`); return null }
      if (!empty) inputs[f.key] = v
    }
    return inputs
  }

  const generatePlan = async () => {
    if (!goal.trim()) { setError('请先写下你的目标'); return }
    const inputs = buildInputs()
    if (inputs === null) return
    setPlanning(true); setPlan(null); setRunId(''); setError('')
    try {
      const res = await agentService.dryRun({
        goal: goal.trim(),
        inputs: Object.keys(inputs).length ? inputs : null,
        agent_key: agentKey,
      })
      setPlan(res)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '生成计划失败')
    } finally {
      setPlanning(false)
    }
  }

  const execute = async () => {
    if (!goal.trim()) { setError('请先写下你的目标'); return }
    const inputs = buildInputs()
    if (inputs === null) return
    setStarting(true); setError('')
    try {
      const prefs = Object.fromEntries(
        Object.entries(modelPrefs).filter(([pl]) => (currentAgent?.allowed_plugins || []).includes(pl))
      )
      const { run_id } = await agentService.createRun({
        goal: goal.trim(),
        inputs: Object.keys(inputs).length ? inputs : null,
        agent_key: agentKey,
        confirm_mode: confirmMode,
        model_prefs: Object.keys(prefs).length ? prefs : null,
      })
      setRunId(run_id)
      setRunStatus('pending')
      await reloadRuns()
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '发起失败')
    } finally {
      setStarting(false)
    }
  }

  const resetCanvas = () => { setPlan(null); setRunId(''); setRunStatus('') }

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 flex min-w-0 overflow-hidden">
          {/* ── 左栏：智能体库 ── */}
          <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-gray-800/60 bg-[#0d0d0f] overflow-y-auto">
            <div className="p-3">
              <button onClick={() => setEditingAgent(null)} disabled={locked}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                <Plus className="w-4 h-4" />新建智能体
              </button>
            </div>

            <RailGroup title="模板（点选即用）" icon={Sparkles}>
              {systemAgents.map((a) => (
                <RailCard key={a.agent_id} agent={a} active={agentKey === a.agent_id}
                  system disabled={locked} onPick={() => pickAgent(a, true)} />
              ))}
              {systemAgents.length === 0 && <RailEmpty text="暂无模板" />}
            </RailGroup>

            <RailGroup title="我的智能体" icon={Bot}>
              {myAgents.map((a) => (
                <RailCard key={a.agent_id} agent={a} active={agentKey === a.agent_id}
                  disabled={locked} onPick={() => pickAgent(a)} onEdit={() => setEditingAgent(a)} />
              ))}
              {myAgents.length === 0 && <RailEmpty text="还没有自定义智能体" />}
            </RailGroup>
          </aside>

          {/* ── 中区：画布 ── */}
          <section className="flex-1 min-w-0 overflow-y-auto px-4 md:px-8 py-4 md:py-6">
            <div className="w-full">
              <div className="flex items-center gap-2 mb-1">
                <Bot className="w-6 h-6 text-pink-400" />
                <h1 className="text-xl md:text-2xl font-bold text-gray-100">智能体工作台</h1>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                说出目标 → 生成计划 → 执行中逐步确认，一屏搞定。
              </p>

              {/* 移动端智能体选择（左栏在小屏隐藏时的兜底） */}
              <div className="md:hidden mb-3">
                <select className="input" value={agentKey} disabled={locked}
                  onChange={(e) => {
                    const a = agents.find((x) => x.agent_id === e.target.value)
                    if (a) pickAgent(a, a.scope === 'system')
                  }}>
                  {agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.name}</option>)}
                </select>
              </div>

              {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
              {locked && (
                <div className="mb-3 flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  执行中，设计器已锁定——如需修改目标或切换智能体，请先在下方取消当前运行。
                </div>
              )}
              {loading && (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />加载中...
                </div>
              )}

              {!loading && (
                <>
                  {/* ── 首屏成果速览（重点展示；与画廊同源，点开进画廊）── */}
                  {showcaseWorks.length > 0 && !runId && !plan && (
                    <div className="mb-5">
                      <div className="flex items-center gap-2 mb-2.5">
                        <span className="text-base font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400">
                          🎉 我的成果 · {showcaseWorks.length}
                        </span>
                        <button onClick={() => setGalleryOpen(true)}
                          className="ml-auto text-[11px] text-gray-400 hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-white/10">
                          全部 / 对比
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                        {showcaseWorks.slice(0, 12).map((w, i) => {
                          const url = googleService.getResultUrl(w.result_url)
                          return (
                            <button key={w.task_id} onClick={() => setGalleryOpen(true)}
                              className={`group relative rounded-xl border overflow-hidden bg-[#16161a] transition-all ${
                                i === 0 ? 'border-pink-500/60 ring-1 ring-pink-500/20' : 'border-gray-800/60 hover:border-gray-600'}`}>
                              {i === 0 && (
                                <span className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow">
                                  NEW
                                </span>
                              )}
                              <div className="aspect-square bg-black/40 flex items-center justify-center">
                                {w.task_type === 'video'
                                  ? <video src={url} className="max-w-full max-h-full" muted />
                                  : <img src={url} alt="" className="max-w-full max-h-full object-contain" />}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── GoalBar ── */}
                  <div className="rounded-2xl border border-gray-800/60 bg-[#16161a] p-4 md:p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] text-gray-500">当前智能体</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300 font-medium">
                        {currentAgent?.name || agentKey}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-gray-300 font-medium">你的目标</span>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => setCharPickerOpen(true)} disabled={locked}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] bg-pink-500/15 text-pink-300 hover:bg-pink-500/25 disabled:opacity-60">
                          <Users className="w-3 h-3" />引用角色
                        </button>
                        <button type="button" onClick={polishGoal} disabled={polishing || locked}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-60">
                          {polishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                          {polishing ? '润色中...' : (goal.trim() ? 'AI 润色' : 'AI 补全示范')}
                        </button>
                      </div>
                    </div>
                    <textarea
                      className="input min-h-[96px] text-sm leading-relaxed disabled:opacity-60"
                      value={goal} onChange={(e) => setGoal(e.target.value)} disabled={locked}
                      placeholder={TEMPLATE_GOALS[agentKey] || '一句话描述你要产出什么，例如：为某商品做一条 15 秒竖屏带货短视频…'} />

                    {/* 更多设置 */}
                    <button type="button" onClick={() => setMoreOpen((v) => !v)} disabled={locked}
                      className="mt-2 flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 disabled:opacity-50">
                      {moreOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      更多设置（输入素材 / 确认方式）
                    </button>
                    {moreOpen && (
                      <div className={`mt-3 space-y-3 border-t border-gray-800/60 pt-3 ${locked ? 'opacity-60 pointer-events-none' : ''}`}>
                        {runFields.length > 0 && (
                          <div>
                            <span className="block text-xs text-gray-400 mb-1">输入素材</span>
                            <RunInputsForm fields={runFields} values={fieldValues} onChange={setFieldValues} />
                          </div>
                        )}

                        {/* 按需求 + 单价选模型（仅展示当前智能体拥有、且有候选的能力）*/}
                        {(currentAgent?.allowed_plugins || [])
                          .filter((pl) => (modelOptions[pl]?.length || 0) > 1)
                          .map((pl) => {
                            const opts = modelOptions[pl]
                            const cur = modelPrefs[pl] || opts[0].model
                            return (
                              <label key={pl} className="block">
                                <span className="block text-xs text-gray-400 mb-1">
                                  {pluginLabel(plugins, pl)} · 模型（不同单价）
                                </span>
                                <select className="input" value={cur}
                                  onChange={(e) => setModelPrefs((m) => ({ ...m, [pl]: e.target.value }))}>
                                  {opts.map((o) => (
                                    <option key={o.model} value={o.model}>
                                      {o.label} · {o.cost} 积分
                                    </option>
                                  ))}
                                </select>
                                <p className="text-[11px] text-gray-600 mt-1">
                                  {opts.find((o) => o.model === cur)?.desc}
                                </p>
                              </label>
                            )
                          })}

                        <label className="block">
                          <span className="block text-xs text-gray-400 mb-1">执行确认方式</span>
                          <select className="input" value={confirmMode}
                            onChange={(e) => setConfirmMode(e.target.value as any)}>
                            {CONFIRM_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                          <p className="text-[11px] text-gray-600 mt-1">
                            默认「逐步确认」——执行中每步可改参/跳过，真正掌控生成过程。
                          </p>
                        </label>
                      </div>
                    )}

                    <div className="mt-4 flex items-center gap-3">
                      {/* 主动作：目标直达执行 */}
                      <button onClick={execute} disabled={starting || planning || !goal.trim() || locked}
                        className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-60">
                        {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        开始生成
                      </button>
                      {/* 次动作：想先看计划的人 */}
                      <button onClick={generatePlan} disabled={planning || starting || !goal.trim() || locked}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40">
                        {planning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                        {plan ? '重新预览计划' : '先预览计划'}
                      </button>
                      {(plan || runId) && (
                        <button onClick={resetCanvas} disabled={locked}
                          className="ml-auto flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-gray-400 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">
                          <RotateCcw className="w-3.5 h-3.5" />清空
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── 计划预览（只读·可参考）── */}
                  {plan && !runId && (
                    <div className="mt-4 rounded-2xl border border-gray-800/60 bg-[#16161a] p-4 md:p-5">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-semibold text-gray-200">执行计划预览</h3>
                        <span className="text-xs text-amber-300">预估合计花费 {plan.estimated_cost}</span>
                      </div>
                      <p className="text-[11px] text-gray-500 mb-3">
                        这是智能体打算怎么做的<b className="text-gray-400">预估·可参考</b>；实际执行时每一步都可在确认闸门改参或跳过。
                      </p>
                      {plan.plan_text && (
                        <p className="text-xs text-gray-400 whitespace-pre-wrap bg-black/30 rounded-lg p-2 mb-3">{plan.plan_text}</p>
                      )}
                      <div className="space-y-2">
                        {plan.planned_tool_calls.map((t, i) => (
                          <div key={i} className="rounded-lg border border-gray-800/60 bg-[#101014] p-3">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-gray-500">#{i + 1}</span>
                              <span className="text-gray-200 font-medium">{t.label}</span>
                              <span className="text-gray-500">({t.name})</span>
                              <span className="ml-auto text-amber-300">花费 {t.cost}</span>
                            </div>
                            <pre className="mt-1 bg-black/30 rounded px-2 py-1 overflow-x-auto text-[10px] text-gray-300 whitespace-pre-wrap break-all">
                              {JSON.stringify(t.args, null, 2)}
                            </pre>
                          </div>
                        ))}
                        {plan.planned_tool_calls.length === 0 && (
                          <p className="text-xs text-gray-600">智能体本轮未规划工具调用——可直接执行，或调整目标后重新生成计划。</p>
                        )}
                      </div>

                      <button onClick={execute} disabled={starting || locked}
                        className="mt-4 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white disabled:opacity-60">
                        {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        按此计划开始生成
                      </button>
                    </div>
                  )}

                  {/* ── 执行阶段（复用 RunDetail）── */}
                  {runId && (
                    <div className="mt-4 rounded-2xl border border-gray-800/60 bg-[#16161a] p-4 md:p-5">
                      <RunDetail runId={runId} onChanged={reloadRuns} hideGoal onStatusChange={setRunStatus} />
                      {canFeedScript && (
                        <div className="mt-4 pt-4 border-t border-gray-800/60 flex items-center gap-3">
                          <div className="flex-1">
                            <p className="text-sm text-gray-200 font-medium">这份脚本可以直接拍成短剧</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">投喂给 OmniWeaver：自动建项目、预填剧本，去拆分分镜、逐镜生成。</p>
                          </div>
                          <button onClick={() => feedToOmniWeaver(scriptText, currentRun?.goal || '')}
                            disabled={feeding}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-indigo-500 to-purple-500 text-white disabled:opacity-60 shrink-0">
                            {feeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
                            投喂 OmniWeaver
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── 历史抽屉 + 成果画廊入口 ── */}
                  <div className="mt-4 flex items-center gap-4">
                    <button onClick={() => setHistoryOpen((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200">
                      <History className="w-3.5 h-3.5" />
                      历史运行（{runs.length}）
                      {historyOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => setGalleryOpen(true)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200">
                      <Images className="w-3.5 h-3.5" />
                      成果画廊（{runs.filter((r) => r.status === 'completed' && r.final_artifacts?.length).length}）
                    </button>
                  </div>
                  <div>
                    <span className="hidden" />
                    {historyOpen && (
                      <div className="mt-2 space-y-3 max-h-[45vh] overflow-y-auto">
                        {runs.length === 0 && <p className="text-xs text-gray-600">暂无</p>}
                        {groupedRuns.map(([key, groupRuns]) => (
                          <div key={key}>
                            <div className="flex items-center gap-1.5 mb-1 px-0.5">
                              <Bot className="w-3 h-3 text-pink-400/70" />
                              <span className="text-[11px] font-medium text-gray-400">{agentName(key)}</span>
                              <span className="text-[10px] text-gray-600">{groupRuns.length}</span>
                            </div>
                            <div className="space-y-1.5">
                              {groupRuns.map((r) => (
                                <button key={r.run_id} onClick={() => { setRunId(r.run_id); setRunStatus(r.status); setPlan(null) }}
                                  className={`w-full text-left rounded-lg px-3 py-2 border transition-colors ${
                                    runId === r.run_id ? 'border-pink-500/60 bg-pink-500/5' : 'border-gray-800/60 hover:border-gray-600'}`}>
                                  <div className="flex items-center gap-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${RUN_STATUS_STYLE[r.status] || 'bg-gray-500/20 text-gray-300'}`}>{r.status}</span>
                                    <span className="text-[10px] text-gray-500 ml-auto">花费 {r.total_cost ?? 0}</span>
                                  </div>
                                  <p className="text-xs text-gray-300 mt-1 line-clamp-2">{r.goal}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        </main>
      </div>

      {/* slide-over 编辑器 */}
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
            setAgentKey(saved.agent_id)
            setEditingAgent(undefined)
          }}
        />
      )}

      {/* 成果画廊（全屏抽屉） */}
      {galleryOpen && (
        <ResultGallery onReuseGoal={reuseGoal}
          agentNames={Object.fromEntries(agents.map((a) => [a.agent_id, a.name]))}
          onClose={() => setGalleryOpen(false)} />
      )}

      {/* 共享 AI 角色库选择 */}
      {charPickerOpen && (
        <AICharacterPickerModal
          onPick={(desc) => insertCharacter(desc)}
          onClose={() => setCharPickerOpen(false)} />
      )}
    </div>
  )
}

// ── 左栏子组件 ────────────────────────────────────────────────────────────────
function pluginLabel(plugins: PluginSpec[], name: string): string {
  return plugins.find((p) => p.name === name)?.label || name
}

function RailGroup({ title, icon: Icon, children }: {
  title: string; icon: any; children: React.ReactNode
}) {
  return (
    <div className="px-3 pb-3">
      <p className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-1.5 px-1">
        <Icon className="w-3.5 h-3.5" />{title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function RailCard({ agent, active, system, disabled, onPick, onEdit }: {
  agent: AgentDef; active: boolean; system?: boolean; disabled?: boolean
  onPick: () => void; onEdit?: () => void
}) {
  return (
    <div onClick={disabled ? undefined : onPick}
      className={`group rounded-lg border px-3 py-2 transition-colors ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${
        active ? 'border-pink-500/60 bg-pink-500/5' : 'border-gray-800/60 hover:border-gray-600 bg-[#16161a]'}`}>
      <div className="flex items-center gap-1.5">
        <Bot className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-pink-400' : 'text-gray-500'}`} />
        <span className="text-xs font-medium text-gray-200 truncate">{agent.name}</span>
        {system
          ? <Lock className="w-3 h-3 text-gray-600 ml-auto shrink-0" />
          : onEdit && (
            <button onClick={(e) => { e.stopPropagation(); if (!disabled) onEdit() }} disabled={disabled}
              className="ml-auto p-0.5 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 disabled:hidden">
              <Pencil className="w-3 h-3 text-gray-400" />
            </button>
          )}
      </div>
      {agent.description && <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{agent.description}</p>}
    </div>
  )
}

function RailEmpty({ text }: { text: string }) {
  return <p className="text-[11px] text-gray-600 px-1 py-1">{text}</p>
}
