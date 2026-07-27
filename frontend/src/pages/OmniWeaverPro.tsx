/**
 * OmniWeaver – 对标火山「剧创」的剧本主线短剧生产台
 *
 * 流程（以剧本创作为主线）：
 *   项目列表(首屏) → 打开/新建项目(=一部短剧系列，含多集)
 *     → 每集：剧本(主线) → 时间段分镜(二级视图，生成每镜必要条件) → 生成本集 → 成片
 *
 * 每个镜头的硬性前置：有序参考图(角色/参考图，≥1) + 时间段 beats(必填)；参考视频/音频各单条可选。
 * 完全适配 Seedance 2.0：提示词 图片N/视频1/音频1 与素材一一对应（见 ShotStoryboardEditor）。
 * 已去除场景描述/动作描述/角色资产库。项目支持归档。
 */
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Film, ArrowLeft, Save, Loader2, Check, Plus, FileText, Clapperboard,
  ListVideo, Trash2, Download, RotateCcw, Scissors, AlertCircle,
  Sparkles, Clock, ChevronRight, ChevronDown, Lock, FileJson, X,
  Music, ImageIcon, Video, Users, Library, MapPin, Package, Layers,
  Pencil, Maximize2,
} from 'lucide-react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  dramaService, DramaProjectRecord, DramaEpisode, EpisodeShot, EpisodeShotImage, EpisodeAsset, SeriesWork,
} from '../services/drama.service'
import { renderService, PipelineStatus, ShotInput } from '../services/render.service'
import { googleService } from '../services/google.service'
import ProjectList from '../components/drama/ProjectList'
import ShotStoryboardEditor from '../components/drama/ShotStoryboardEditor'
import AssetConfigPanel from '../components/drama/AssetConfigPanel'
import AssetPickerModal from '../components/drama/AssetPickerModal'
import AssetThumb from '../components/drama/AssetThumb'
import AssetPreviewModal from '../components/drama/AssetPreviewModal'

// 配置来源徽标（整集素材库图片来自配置时展示）
const GLOBAL_ASSET_SRC: Record<'character' | 'scene' | 'prop', { label: string; icon: typeof Users }> = {
  character: { label: '角色', icon: Users },
  scene: { label: '场景', icon: MapPin },
  prop: { label: '道具', icon: Package },
}
import { type Beat, defaultBeats, buildPrompt, parseExplicitSegments, scanMaterialRefs } from '../utils/drama-compose'

type SubView = 'script' | 'storyboard' | 'render'

const STEPS: { key: SubView; label: string; icon: typeof FileText }[] = [
  { key: 'script', label: '编写剧本', icon: FileText },
  { key: 'storyboard', label: '拆分分镜', icon: Clapperboard },
  { key: 'render', label: '生成成片', icon: ListVideo },
]

const DURATION_OPTIONS = [3, 5, 8, 10, 12]

function genId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 剧本 → {整集创意, 分镜[]}：按空行/场景标记拆块。每块若含明确时间分镜则机械填充 beats（不改写用户文字），
 *  否则只留待 AI 草拟。`_explicit` 标记该镜已由用户文本填好、无需 AI。
 *  创意描述（各块时间标记前的引导文字）汇总为**整集共享** global_desc，不落到单镜。
 *  另按文中引用的「图片N / 视频N / 音频N」预建空素材槽（pending 图片槽默认首尾帧图 + 视频/音频名称）。 */
function parseScript(text: string, duration = 5): { episodeGlobal: string; shots: (EpisodeShot & { _explicit?: boolean; _draftDesc?: string })[] } {
  const blocks = text
    .split(/\n{2,}|(?=^(?:场景|镜头|SCENE|INT\.|EXT\.|第.+[场幕镜])[：:\s])/im)
    .map(b => b.trim())
    .filter(Boolean)
  const globals: string[] = []
  const shots = blocks.map((block, i) => {
    const parsed = parseExplicitSegments(block, duration)
    const refs = scanMaterialRefs(block)
    // 按文中「图片N」预建 N 个空槽（统一「图片N」，可命名），等待上传
    const pendingImages: EpisodeShot['images'] = Array.from({ length: refs.imageCount }, () => ({
      key: '', name: '', kind: 'frame',
      label: '', pending: true,
    }))
    const matPatch: Partial<EpisodeShot> = {}
    if (refs.hasVideo) matPatch.reference_video_label = '视频1'
    if (refs.hasAudio) matPatch.audio_label = '音频1'
    if (parsed && parsed.beats.length > 0) {
      if (parsed.global) globals.push(parsed.global)
      // 用户已写明时间分镜：逐字填充 beats；创意描述上移整集，单镜不再保留 global_desc
      return {
        id: genId(), index: i + 1, duration: parsed.duration,
        global_desc: '', beats: parsed.beats, images: pendingImages,
        ...matPatch, _explicit: true,
      }
    }
    // 无显式时间段：整块文字视为该段创意，汇入整集创意；beats 留给 AI 草拟（用 _draftDesc 传文）
    globals.push(block)
    return {
      id: genId(), index: i + 1, duration,
      global_desc: '', beats: [], images: pendingImages,
      ...matPatch, _explicit: false, _draftDesc: block,
    }
  })
  // 去重拼接整集创意
  const episodeGlobal = Array.from(new Set(globals.map(g => g.trim()).filter(Boolean))).join('\n')
  return { episodeGlobal, shots }
}

/** 项目状态随内容推导：每集都有成片→已完成；有剧本/分镜但未全部出片→进行中；空→草稿。 */
function deriveProjectStatus(eps: DramaEpisode[]): 'draft' | 'in_progress' | 'completed' {
  const hasContent = eps.some(ep => (ep.script_text || '').trim() || ep.shots.length > 0)
  const allComposed = eps.length > 0 && eps.every(ep => !!ep.composite_url)
  return allComposed ? 'completed' : hasContent ? 'in_progress' : 'draft'
}

/** 整集素材库里「应用到所有分镜」的图片（applyToAll 缺省视为 true，且必须已上传 key）。
 *  这些图片作为全局参考图，自动引用进本集每个分镜，排在该镜自有图片之前（图片1..G）。 */
function appliedGlobalImages(ep: DramaEpisode): EpisodeShotImage[] {
  return (ep.assets ?? [])
    .filter(a => a.type === 'image' && a.key && a.applyToAll !== false)
    .map(a => ({
      key: a.key,
      name: a.name,
      kind: 'frame' as const,
      label: a.label,
      frame: a.frame,
      usage: a.usage,
      desc: a.desc,
      assetId: a.assetId,
      assetType: a.assetType,
    }))
}

/** 某镜「有效参考图」= 整集全局应用图片（图片1..G） + 本镜自有已上传图片。
 *  全局图片排在最前，决定提示词与 API content 里「图片N」的序号。 */
function effectiveShotImages(ep: DramaEpisode, shot: EpisodeShot): EpisodeShotImage[] {
  const own = (shot.images ?? []).filter(im => im.key && !im.pending)
  return [...appliedGlobalImages(ep), ...own]
}

/** 某镜是否配齐：至少 1 张有效参考图（全局应用 或 本镜自有） + 至少一段有内容的 beat。
 *  全局应用了图片时，分镜无需各自上传也满足参考图必填规则。 */
function isShotReady(ep: DramaEpisode, shot: EpisodeShot): boolean {
  const hasBeat = (shot.beats ?? []).some(b => (b.action || b.sfx || b.voice || '').trim())
  return effectiveShotImages(ep, shot).length >= 1 && hasBeat
}

/** 某镜「确定性基线提示词」：与后端 build_beat_prompt / ShotPromptCard 同款拼装，
 *  作为检测分镜是否被修改的签名（输入变→字符串变）。 */
function buildShotBaseline(ep: DramaEpisode, shot: EpisodeShot): string {
  const images = effectiveShotImages(ep, shot)
  const hasVideo = !!shot.reference_video_key
  const hasAnyAudio = !!shot.audio_key || !!ep.bgm?.key
  const audioLabel = shot.audio_key ? shot.audio_label : ep.bgm?.label
  return buildPrompt({
    global: [ep.global_desc, shot.global_desc].map(x => (x || '').trim()).filter(Boolean).join('\n'),
    beats: (shot.beats ?? []) as Beat[],
    images: images.map(im => ({ kind: im.kind, label: im.label, frame: im.frame, usage: im.usage, desc: im.desc, name: im.name, assetType: im.assetType })),
    video: hasVideo ? { label: shot.reference_video_label } : null,
    audio: hasAnyAudio ? { label: audioLabel } : null,
    composition: ep.composition,
    narration: ep.narration,
  })
}

/** 已出成片，但之后分镜发生变化（当前确定性基线≠生成时快照）⇒ 成片已过期，需按最新分镜重绘。
 *  旧数据无 rendered_prompt 快照时不误报。 */
function videoNeedsRerender(ep: DramaEpisode, shot: EpisodeShot): boolean {
  const done = shot.videoStatus === 'completed' && !!shot.videoTaskId
  return done && shot.rendered_prompt != null && buildShotBaseline(ep, shot) !== shot.rendered_prompt
}

/** 本镜总时长 = 各时间段(beats)时长累加（动态）；无可解析时间段时回退 shot.duration。 */
function shotTotalDuration(shot: EpisodeShot): number {
  const sum = (shot.beats ?? []).reduce((s, b) => {
    const m = /([\d.]+)\s*-\s*([\d.]+)/.exec(b.time || '')
    return s + (m ? Math.max(0, parseFloat(m[2]) - parseFloat(m[1])) : 0)
  }, 0)
  return sum > 0 ? Math.round(sum) : (shot.duration || 5)
}

/** 兼容旧存档：图片 kind 角色/事物→首尾帧图/插图；把残留的单镜 global_desc 上移整集。 */
function migrateEpisode(ep: DramaEpisode): DramaEpisode {
  const legacyGlobals: string[] = []
  const shots = (ep.shots ?? []).map(s => {
    const images = (s.images ?? []).map(im => {
      const k = im.kind as string
      if (k === 'character' || k === 'reference') {
        return { ...im, kind: k === 'reference' ? 'illustration' : 'frame' } as typeof im
      }
      return im
    })
    if ((s.global_desc || '').trim()) legacyGlobals.push(s.global_desc!.trim())
    return { ...s, images, global_desc: '' }
  })
  const merged = Array.from(new Set([
    ...(ep.global_desc ? [ep.global_desc.trim()] : []),
    ...legacyGlobals,
  ].filter(Boolean)))
  return { ...ep, shots, global_desc: merged.join('\n') }
}

export default function OmniWeaverPage() {
  useDocumentTitle('OmniWeaver · AI短剧')
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // ── 顶层视图 ──
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [activeProject, setActiveProject] = useState<DramaProjectRecord | null>(null)
  const [projectName, setProjectName] = useState('')

  // ── 编辑器状态 ──
  const [episodes, setEpisodes] = useState<DramaEpisode[]>([])
  const [epIdx, setEpIdx] = useState(0)
  const [subView, setSubView] = useState<SubView>('script')
  // 编辑器主视图：多集创作 | 配置（角色/场景/道具）
  const [editorMode, setEditorMode] = useState<'episodes' | 'config' | 'series' | 'theater'>('episodes')

  // ── 自动保存 ──
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState('')
  const dirtyRef = useRef(false)
  const hydratingRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const renderingRef = useRef(false)   // 生成中：抑制频繁自动保存，完成后统一保存一次
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSaveRef = useRef<() => void>(() => {})
  const episodesRef = useRef(episodes)
  const projectNameRef = useRef(projectName)
  const activeProjectRef = useRef(activeProject)
  useEffect(() => { episodesRef.current = episodes }, [episodes])
  useEffect(() => { projectNameRef.current = projectName }, [projectName])
  useEffect(() => { activeProjectRef.current = activeProject }, [activeProject])

  const aspect = activeProject?.aspect_ratio || '9:16'
  const currentEp = episodes[epIdx]

  const scheduleAutosave = useCallback((delay = 1500) => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      if (dirtyRef.current && !saveInFlightRef.current) handleSaveRef.current()
    }, delay)
  }, [])

  // ── 项目打开 / 新建 ──
  const openProject = async (proj: DramaProjectRecord) => {
    let full = proj
    if (proj.episodes_data === undefined) {
      try { full = await dramaService.getProject(proj.project_id) } catch { full = proj }
    }
    hydratingRef.current = true
    const eps = (full.episodes_data?.episodes ?? []).map(migrateEpisode)
    setActiveProject(full)
    setProjectName(full.name)
    setEpisodes(eps.length ? eps : [defaultEpisode(1)])
    setEpIdx(0)
    setSubView('script')
    setEditorMode('episodes')
    dirtyRef.current = false; setDirty(false)
    setLastSaved(null); setSaveError('')
    setView('editor')
  }

  const handleCreateProject = (proj: DramaProjectRecord) => {
    hydratingRef.current = true
    setActiveProject(proj)
    setProjectName(proj.name)
    setEpisodes([defaultEpisode(1)])
    setEpIdx(0)
    setSubView('script')
    setEditorMode('episodes')
    dirtyRef.current = false; setDirty(false)
    setLastSaved(null); setSaveError('')
    setView('editor')
  }

  // 从智能体工作台"投喂 OmniWeaver"跳转而来：携带 openProjectId → 自动打开该项目。
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    const pid = (location.state as any)?.openProjectId
    if (!pid || autoOpenedRef.current) return
    autoOpenedRef.current = true
    // 消费掉 state，避免刷新/返回时重复打开。
    navigate(location.pathname, { replace: true, state: null })
    dramaService.getProject(pid)
      .then((proj) => openProject(proj))
      .catch(() => { /* 打开失败则停留在列表页 */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  function defaultEpisode(n: number): DramaEpisode {
    return { episode: n, title: '', script_text: '', shots: [] }
  }

  // ── 保存 ──
  const handleSave = useCallback(async () => {
    const proj = activeProjectRef.current
    if (!proj) return
    if (saveInFlightRef.current) { dirtyRef.current = true; setDirty(true); return }
    saveInFlightRef.current = true
    dirtyRef.current = false; setDirty(false); setSaving(true)
    try {
      // 序列化：剥离图片 displayUrl（仅运行时）
      const cleanEps: DramaEpisode[] = episodesRef.current.map(ep => ({
        ...ep,
        shots: ep.shots.map(s => ({
          ...s,
          images: (s.images ?? []).map(({ displayUrl, ...rest }) => { void displayUrl; return rest }),
        })),
      }))
      // 项目状态随内容推导：不再写死 in_progress，否则成片完成后卡片仍永远显示「进行中」。
      const projectStatus = deriveProjectStatus(cleanEps)
      const updated = await dramaService.updateProject(proj.project_id, {
        name: projectNameRef.current,
        episode_count: cleanEps.length,
        status: projectStatus,
        episodes_data: { episodes: cleanEps },
      })
      setActiveProject(updated)
      setLastSaved(new Date())
    } catch (e: any) {
      setSaveError(e?.response?.data?.detail || e?.message || '保存失败')
      setTimeout(() => setSaveError(''), 4000)
      dirtyRef.current = true; setDirty(true)
    } finally {
      setSaving(false)
      saveInFlightRef.current = false
      if (dirtyRef.current) scheduleAutosave(800)
    }
  }, [scheduleAutosave])
  useEffect(() => { handleSaveRef.current = handleSave }, [handleSave])

  // 任意编辑 → 防抖保存
  useEffect(() => {
    if (!activeProjectRef.current) return
    if (hydratingRef.current) { hydratingRef.current = false; return }
    dirtyRef.current = true; setDirty(true)
    // 生成过程中轮询会高频更新 episodes（逐镜状态/成片），不触发自动保存；
    // 结束后由 finishRender 统一保存一次，避免每 ~1.5s 写一次库。
    if (renderingRef.current) return
    scheduleAutosave()
  }, [episodes, projectName, scheduleAutosave])

  // 离开提醒
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  const leaveEditor = useCallback(() => {
    if (renderingRef.current) return  // 生成/草拟中禁止离开
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    if (dirtyRef.current && !saveInFlightRef.current) handleSaveRef.current()
    setView('list')
  }, [])

  // ── 集 / 镜 编辑 ──
  const patchEpisode = useCallback((idx: number, patch: Partial<DramaEpisode>) => {
    setEpisodes(prev => prev.map((ep, i) => (i === idx ? { ...ep, ...patch } : ep)))
  }, [])
  const patchShot = useCallback((idx: number, shotId: string, patch: Partial<EpisodeShot>) => {
    setEpisodes(prev => prev.map((ep, i) => i === idx
      ? { ...ep, shots: ep.shots.map(s => (s.id === shotId ? { ...s, ...patch } : s)) }
      : ep))
  }, [])
  const addEpisode = () => {
    setEpisodes(prev => {
      const n = prev.length + 1
      return [...prev, defaultEpisode(n)]
    })
    setEpIdx(episodes.length)
    setSubView('script')
  }
  const removeEpisode = (idx: number) => {
    setEpisodes(prev => prev.filter((_, i) => i !== idx).map((ep, i) => ({ ...ep, episode: i + 1, title: ep.title })))
    setEpIdx(i => Math.max(0, Math.min(i, episodes.length - 2)))
  }

  // 剧本 → 分镜（弹出时长选择 → 拆分 + 自动草拟时间段）
  const [showDurationModal, setShowDurationModal] = useState(false)
  const [splitDuration, setSplitDuration] = useState(5)
  const [bulkDrafting, setBulkDrafting] = useState(false)
  const [draftProgress, setDraftProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [storyboardError, setStoryboardError] = useState('')

  const openDurationModal = () => {
    if (!currentEp?.script_text?.trim()) return
    setSplitDuration(currentEp.shots[0]?.duration || 5)
    setShowDurationModal(true)
  }

  // 「编写剧本」里点拆分：若本集已有分镜，先确认（防重复拆分/覆盖已设计结果）
  const [showResplitConfirm, setShowResplitConfirm] = useState(false)
  const requestSplit = () => {
    if (!currentEp?.script_text?.trim()) return
    if (currentEp.shots.length > 0) { setShowResplitConfirm(true); return }
    openDurationModal()
  }

  // 确认时长 → 拆分本集分镜 → 含明确时间分镜的镜头逐字填充，其余 AI 草拟 → 进入可编辑详情
  const confirmSplit = async () => {
    if (!currentEp) return
    const { episodeGlobal, shots: baseShots } = parseScript(currentEp.script_text || '', splitDuration)
    setShowDurationModal(false)
    if (baseShots.length === 0) {
      setStoryboardError('剧本为空，无法拆分分镜')
      setTimeout(() => setStoryboardError(''), 4000)
      return
    }
    // 先落地分镜（含已填好的显式分镜）+ 整集创意，并切到分镜步骤；只有缺时间段的镜头才异步 AI 草拟
    const strip = (s: EpisodeShot & { _explicit?: boolean; _draftDesc?: string }): EpisodeShot => {
      const { _explicit, _draftDesc, ...rest } = s; void _explicit; void _draftDesc; return rest
    }
    patchEpisode(epIdx, { shots: baseShots.map(strip), global_desc: episodeGlobal, prompts_confirmed: false })
    setSubView('storyboard')
    const pending = baseShots.filter(s => !s._explicit)
    if (pending.length === 0) return  // 全部由用户文本填好，无需 AI
    setBulkDrafting(true)
    setStoryboardError('')
    setDraftProgress({ done: 0, total: pending.length })
    let done = 0
    const drafted = [...baseShots]
    for (let i = 0; i < drafted.length; i++) {
      const s = drafted[i]
      if (s._explicit) continue  // 用户已写明，绝不改写
      try {
        const res = await dramaService.generateBeatScript({
          description: s._draftDesc || episodeGlobal || '',
          duration: s.duration || splitDuration,
          aspect_ratio: aspect,
        })
        drafted[i] = {
          ...s,
          beats: res.beats?.length
            ? res.beats.map(b => ({ time: b.time || '', action: b.action || '' }))
            : defaultBeats(s.duration || splitDuration),
        }
      } catch {
        drafted[i] = { ...s, beats: defaultBeats(s.duration || splitDuration) }
      }
      done++
      setDraftProgress({ done, total: pending.length })
      patchEpisode(epIdx, { shots: drafted.map(strip) })
    }
    setBulkDrafting(false)
  }

  const addShot = () => {
    if (!currentEp) return
    patchEpisode(epIdx, {
      shots: [...currentEp.shots, {
        id: genId(), index: currentEp.shots.length + 1, duration: 5,
        global_desc: '', beats: [], images: [],
      }],
    })
  }
  const removeShot = (shotId: string) => {
    if (!currentEp) return
    patchEpisode(epIdx, {
      shots: currentEp.shots.filter(s => s.id !== shotId).map((s, i) => ({ ...s, index: i + 1 })),
    })
  }

  // ── 渲染（按集） ──
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState('')
  const pollingRef = useRef(false)

  // 生成结束：解除锁定并统一保存一次（含成片/逐镜结果回写）
  const finishRender = useCallback(() => {
    setRendering(false)
    pollingRef.current = false
    renderingRef.current = false
    // 渲染期间被抑制的更改，结束后落库一次
    dirtyRef.current = true; setDirty(true)
    scheduleAutosave(300)
  }, [scheduleAutosave])

  const applyPipelineUpdate = useCallback((idx: number, ps: PipelineStatus) => {
    setEpisodes(prev => prev.map((ep, i) => {
      if (i !== idx) return ep
      const byId = new Map(ps.shot_tasks.map(st => [st.shot_id, st]))
      return {
        ...ep,
        composite_url: ps.composite_url ?? ep.composite_url,
        shots: ep.shots.map(s => {
          const st = byId.get(s.id)
          if (!st) return s
          return {
            ...s,
            videoTaskId: st.task_id,
            videoStatus: st.status,
            videoUrl: st.result_url ?? s.videoUrl,
            videoError: st.error ?? undefined,
          }
        }),
      }
    }))
    if (['completed', 'failed', 'partial'].includes(ps.status)) {
      finishRender()
    }
  }, [finishRender])

  // 生成分镜视频（compose=false：只逐镜出片，不拼接；成片由「合并成片」步骤显式触发）。
  // shotIds 省略 = 全部生成；传 [id] = 分别生成单镜。
  const generateShots = async (shotIds?: string[]) => {
    if (!currentEp || !activeProject) return
    const targets = currentEp.shots.filter(
      s => isShotReady(currentEp, s) && (!shotIds || shotIds.includes(s.id)),
    )
    if (targets.length === 0) {
      setRenderError('所选分镜未配齐「时间段分镜 + 至少 1 张图」')
      setTimeout(() => setRenderError(''), 4000)
      return
    }
    // Seedance 单次生成上限 12s：某镜时间段合计超 12s 会被网关拒绝(InvalidParameter)。
    // 提前拦截并给出明确原因，而非让其静默失败。
    const tooLong = targets.filter(s => shotTotalDuration(s) > 12)
    if (tooLong.length > 0) {
      const names = tooLong.map(s => `分镜${s.index}(${shotTotalDuration(s)}s)`).join('、')
      setRenderError(`${names} 时间段合计超过单次生成上限 12 秒——请缩短时间段或拆成多个分镜，再用「合并成片」拼接。`)
      setTimeout(() => setRenderError(''), 8000)
      return
    }
    setRendering(true); setRenderError(''); pollingRef.current = true; renderingRef.current = true
    const targetIds = new Set(targets.map(s => s.id))
    patchEpisode(epIdx, {
      shots: currentEp.shots.map(s =>
        targetIds.has(s.id)
          // 记录本次生成所用「确定性基线」快照：之后分镜若变化即可判定成片过期
          ? { ...s, videoStatus: 'pending', videoError: undefined, rendered_prompt: buildShotBaseline(currentEp, s) }
          : s,
      ),
    })
    try {
      const shots: ShotInput[] = targets.map(s => ({
        id: s.id,
        index: s.index,
        duration: shotTotalDuration(s),
        aspect_ratio: aspect,
        global_desc: [currentEp.global_desc, s.global_desc].map(x => (x || '').trim()).filter(Boolean).join('\n'),
        composition: currentEp.composition,
        narration: currentEp.narration,
        beats: s.beats.map(b => ({ time: b.time, action: b.action, sfx: b.sfx, voice: b.voice, imageRef: b.imageRef, shotSize: b.shotSize })),
        // 有效图片 = 整集全局应用图片（图片1..G） + 本镜自有图片；序号即 API content 顺序
        images: effectiveShotImages(currentEp, s).map(im => ({ key: im.key, name: im.name, kind: im.kind, label: im.label, frame: im.frame, usage: im.usage, desc: im.desc, assetType: im.assetType })),
        reference_video_key: s.reference_video_key,
        reference_video_label: s.reference_video_label,
        // 音频/BGM：本镜自有音频优先，否则用整集 BGM 关联的音频文件（按名称代入提示词）
        audio_key: s.audio_key || currentEp.bgm?.key,
        audio_label: s.audio_key ? s.audio_label : currentEp.bgm?.label,
      }))
      const resp = await renderService.startPipeline(shots, 'kling-v1', aspect, {
        dramaProjectId: activeProject.project_id,
        episode: currentEp.episode,
        compose: false,
      })
      patchEpisode(epIdx, { pipeline_id: resp.pipeline_id })
      const capturedIdx = epIdx
      renderService.pollPipeline(resp.pipeline_id, ps => applyPipelineUpdate(capturedIdx, ps))
        .catch(() => { finishRender() })
    } catch (e: any) {
      finishRender()
      setRenderError(e?.response?.data?.detail || e?.message || '启动生成失败')
      setTimeout(() => setRenderError(''), 6000)
    }
  }

  // ── 恢复轮询 ──
  // 打开项目时，若某集已启动渲染（有 pipeline_id）但还没成片（无 composite_url），
  // 继续轮询：把后端「已完成但前端超时/刷新错过」的成片接回来，无需重新生成扣分。
  const resumedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const proj = activeProject
    if (!proj) return
    episodes.forEach((ep, idx) => {
      if (!ep.pipeline_id || ep.composite_url) return
      const key = `${proj.project_id}:${ep.pipeline_id}`
      if (resumedRef.current.has(key)) return   // 同一管线只恢复一次
      resumedRef.current.add(key)
      pollingRef.current = true; renderingRef.current = true; setRendering(true)
      renderService.pollPipeline(ep.pipeline_id, ps => applyPipelineUpdate(idx, ps))
        .catch(() => { finishRender() })
    })
  }, [activeProject, episodes, applyPipelineUpdate, finishRender])

  // ── 状态自愈 ──
  // 库里项目状态与内容不符时纠正一次（如成片已完成但旧数据仍 in_progress，
  // 且已无渲染可触发保存）。保存后 activeProject.status 与推导值一致，effect 不再触发，无循环。
  useEffect(() => {
    const proj = activeProject
    if (!proj || proj.archived_at || renderingRef.current) return
    if (deriveProjectStatus(episodes) !== proj.status) {
      dirtyRef.current = true; setDirty(true)
      scheduleAutosave(500)
    }
  }, [activeProject, episodes, scheduleAutosave])

  // ── 渲染计算 ──
  const epReady = !!currentEp && currentEp.shots.length > 0 && currentEp.shots.every(s => isShotReady(currentEp, s))
  const notReadyCount = currentEp ? currentEp.shots.filter(s => !isShotReady(currentEp, s)).length : 0

  // ── 步骤完成度 ──
  // script: 有剧本文字｜storyboard: 每镜配齐｜render: 有成片
  const stepDone: Record<SubView, boolean> = {
    script: !!currentEp?.script_text?.trim(),
    storyboard: epReady,
    render: !!currentEp?.composite_url,
  }
  // 「有更新」提示：分镜被改动后成片相对最新分镜已过期，突出在对应步骤
  const stepHasUpdate: Record<SubView, boolean> = {
    script: false,
    storyboard: false,
    render: !!currentEp && currentEp.shots.some(s => videoNeedsRerender(currentEp, s)),
  }
  // 生成/草拟进行中：锁定一切会改动数据或离开当前步骤的交互
  const locked = rendering || bulkDrafting

  // 某步骤是否可点击：该步骤之前的所有步骤都已完成（已保存步骤可回溯）
  const stepReachable = (key: SubView): boolean => {
    if (locked) return false
    const i = STEPS.findIndex(s => s.key === key)
    if (i <= 0) return true
    return STEPS.slice(0, i).every(s => stepDone[s.key])
  }
  const gotoStep = (key: SubView) => {
    if (!stepReachable(key)) return
    // 进入「拆分分镜」且本集尚无分镜：先选时长
    if (key === 'storyboard' && currentEp && currentEp.shots.length === 0) {
      openDurationModal()
      return
    }
    setSubView(key)
  }


  // ── 项目列表视图 ──
  if (view === 'list') {
    return (
      <div className="h-screen flex flex-col bg-[#0a0a0f] overflow-hidden">
        <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <ProjectList onOpenProject={openProject} onCreate={handleCreateProject} />
          </div>
        </div>
      </div>
    )
  }

  // ── 编辑器视图 ──
  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f] overflow-hidden">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">

          {/* 顶栏 */}
          <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 py-2.5 border-b border-white/5 bg-[#0d0d15]">
            <button onClick={leaveEditor} disabled={locked} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed">
              <ArrowLeft className="w-3.5 h-3.5" />项目列表
            </button>
            <div className="w-px h-4 bg-white/10" />
            <input value={projectName} onChange={e => setProjectName(e.target.value)} disabled={locked}
              className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-gray-100 placeholder-gray-600 focus:outline-none disabled:opacity-60"
              placeholder="项目名称" />
            {saveError ? <span className="text-[10px] text-red-400 hidden sm:flex">{saveError}</span>
              : saving ? <span className="text-[10px] text-indigo-300 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />保存中…</span>
              : locked ? <span className="text-[10px] text-indigo-300 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{bulkDrafting ? '草拟中…' : '生成中…'}</span>
              : dirty ? <span className="text-[10px] text-amber-400/80 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />未保存</span>
              : lastSaved ? <span className="text-[10px] text-gray-700 flex items-center gap-1"><Check className="w-3 h-3" />已保存</span>
              : null}
            <button onClick={handleSave} disabled={saving || locked}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-40 border border-indigo-500/20">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}保存
            </button>
          </div>

          {/* 项目主视图切换：多集创作 | 配置（角色/场景/道具）
              页签自适应撑满整行宽度、各自保底最小宽度（最小窗口仍可编辑）；
              内容靠左对齐（justify-start），撑宽后导航文字始终锚定左上角相对位置。 */}
          <div className="flex-shrink-0 flex items-stretch gap-1 px-4 md:px-6 border-b border-white/5 bg-[#0d0d15]">
            {([
              { key: 'config', label: '要素配置', icon: Users },
              { key: 'episodes', label: '多集创作', icon: Film },
              { key: 'series', label: '合并成剧', icon: Layers },
              { key: 'theater', label: '放映剧场', icon: Video },
            ] as const).map(m => {
              const active = editorMode === m.key
              return (
                <button key={m.key} disabled={locked}
                  onClick={() => { if (!locked) setEditorMode(m.key) }}
                  className={`flex flex-1 min-w-[96px] items-center justify-start gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors disabled:opacity-40 ${
                    active ? 'border-indigo-400 text-indigo-200'
                    : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
                  <m.icon className="w-3.5 h-3.5 flex-shrink-0" />{m.label}
                </button>
              )
            })}
          </div>

          {editorMode === 'config' ? (
            <AssetConfigPanel projectId={activeProject!.project_id} aspect={aspect} locked={locked} />
          ) : editorMode === 'series' ? (
            <SeriesComposePanel episodes={episodes} aspect={aspect}
              projectId={activeProject!.project_id} projectName={projectName} />
          ) : editorMode === 'theater' ? (
            <TheaterPanel projectId={activeProject!.project_id} active={editorMode === 'theater'}
              episodes={episodes} projectName={projectName} />
          ) : (
          <>
          {/* 顶级剧集 Tab：动态增删，快速翻阅编辑（未命名用默认名，已命名则覆盖） */}
          <EpisodeTabs episodes={episodes} epIdx={epIdx} locked={locked}
            onSelect={i => { if (!locked) { setEpIdx(i); setSubView('script') } }}
            onAdd={addEpisode} onRemove={removeEpisode} />

          {/* 内容：单列 · 手风琴步骤导航（宽度动态撑满右侧区域，保留合适最小宽度） */}
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 min-h-0">
              {!currentEp ? (
                <p className="text-sm text-gray-600 w-full min-w-[320px]">请先创建一集。</p>
              ) : (
                <div className="w-full min-w-[320px] space-y-3">
                  {STEPS.map((step, i) => {
                    const active = subView === step.key
                    const isRender = step.key === 'render'
                    return (
                      <AccordionStep key={step.key} step={step} order={i + 1}
                        active={active} done={stepDone[step.key]} reachable={stepReachable(step.key)}
                        locked={locked} highlight={isRender} badge={stepHasUpdate[step.key]}
                        meta={step.key === 'storyboard' ? `${currentEp.shots.length}镜` : undefined}
                        onToggle={() => gotoStep(step.key)}>
                        {step.key === 'script' ? (
                          <ScriptView ep={currentEp} locked={locked}
                            onTitle={t => patchEpisode(epIdx, { title: t })}
                            onScript={s => patchEpisode(epIdx, { script_text: s })} onParse={requestSplit} />
                        ) : step.key === 'storyboard' ? (
                          <StoryboardView ep={currentEp} dramaProjectId={activeProject!.project_id} aspect={aspect}
                            onPatchShot={(id, p) => patchShot(epIdx, id, p)}
                            onPatchEp={p => patchEpisode(epIdx, p)}
                            onAddShot={() => addShot()}
                            onRemoveShot={id => removeShot(id)}
                            onNext={() => setSubView('render')} onReSplit={requestSplit}
                            onBackToScript={() => setSubView('script')}
                            epReady={epReady} notReadyCount={notReadyCount}
                            bulkDrafting={bulkDrafting} draftProgress={draftProgress}
                            rendering={rendering} storyboardError={storyboardError} />
                        ) : (
                          <RenderView ep={currentEp} rendering={rendering} renderError={renderError}
                            aspect={aspect} projectId={activeProject?.project_id || ''}
                            onMergeComplete={(url) => patchEpisode(epIdx, { composite_url: url })}
                            onGenerateShots={generateShots} onBackToStoryboard={() => setSubView('storyboard')} epReady={epReady} />
                        )}
                      </AccordionStep>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          </>
          )}
        </div>
      </div>

      {/* 时长选择弹窗（拆分分镜前） */}
      {showDurationModal && (
        <DurationModal value={splitDuration} onChange={setSplitDuration}
          onConfirm={confirmSplit} onCancel={() => setShowDurationModal(false)} />
      )}

      {/* 重新拆分确认（本集已有分镜，防止覆盖已设计结果） */}
      {showResplitConfirm && currentEp && (
        <ResplitConfirmModal shotCount={currentEp.shots.length}
          onCancel={() => setShowResplitConfirm(false)}
          onConfirm={() => { setShowResplitConfirm(false); openDurationModal() }} />
      )}
    </div>
  )
}

/* ── 顶级剧集 Tab 栏 ──
 * 动态增删的浏览器式页签，按集数横向排列、可快速翻阅编辑。
 * 标签名：未命名回退「第N集」默认名，已命名则覆盖显示。 */
function EpisodeTabs({ episodes, epIdx, locked, onSelect, onAdd, onRemove }: {
  episodes: DramaEpisode[]; epIdx: number; locked: boolean
  onSelect: (i: number) => void; onAdd: () => void; onRemove: (i: number) => void
}) {
  // 删除本集二次确认：记录待确认的集索引（防误删）
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null)
  return (
    <div className="flex-shrink-0 flex items-center gap-1 px-3 md:px-4 border-b border-white/5 bg-[#0d0d15] overflow-x-auto">
      {episodes.map((ep, i) => {
        const active = i === epIdx
        const label = (ep.title || '').trim() || `第${ep.episode}集`
        const confirming = confirmIdx === i
        return (
          <div key={i}
            onClick={() => { if (!locked) { onSelect(i); setConfirmIdx(null) } }}
            title={label}
            className={`group relative flex items-center gap-1.5 flex-shrink-0 max-w-[180px] px-3 py-2 text-xs border-b-2 transition-colors ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${
              active ? 'border-indigo-400 text-indigo-200 bg-indigo-500/10'
              : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'}`}>
            <Film className={`w-3 h-3 flex-shrink-0 ${active ? 'text-indigo-400' : 'text-gray-600'}`} />
            <span className="truncate">{label}</span>
            <span className="text-[9px] text-gray-600 flex-shrink-0">{ep.shots.length}镜</span>
            {episodes.length > 1 && !locked && (
              confirming ? (
                <span className="ml-0.5 flex-shrink-0 flex items-center gap-1">
                  <button onClick={ev => { ev.stopPropagation(); setConfirmIdx(null); onRemove(i) }} title="确认删除本集"
                    className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30">确认删除</button>
                  <button onClick={ev => { ev.stopPropagation(); setConfirmIdx(null) }} title="取消"
                    className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-500 hover:bg-white/10">取消</button>
                </span>
              ) : (
                <button onClick={ev => { ev.stopPropagation(); setConfirmIdx(i) }} title="删除本集"
                  className="ml-0.5 flex-shrink-0 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-3 h-3" />
                </button>
              )
            )}
          </div>
        )
      })}
      <button onClick={onAdd} disabled={locked} title="新增一集"
        className="flex-shrink-0 flex items-center gap-1 px-2.5 py-2 ml-1 text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed">
        <Plus className="w-3.5 h-3.5" />加一集
      </button>
    </div>
  )
}

/* ── 放映剧场 ──
 * 上下布局：上侧影院大屏播放当前作品；中部可展开剧本；下侧胶片库横向陈列所有整剧成片，
 * 支持内联编辑名称（决定展示名与下载文件名）、下载、删除。 */
function TheaterPanel({ projectId, active, episodes, projectName }: {
  projectId: string; active: boolean; episodes: DramaEpisode[]; projectName: string
}) {
  const [works, setWorks] = useState<SeriesWork[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState<SeriesWork | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [scriptOpen, setScriptOpen] = useState(true)

  useEffect(() => {
    if (!active) return
    let alive = true
    setLoading(true); setError('')
    dramaService.listSeriesWorks(projectId)
      .then(list => { if (!alive) return; setWorks(list); setPlaying(prev => prev || list[0] || null) })
      .catch(e => { if (alive) setError(e?.response?.data?.detail || e?.message || '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [projectId, active])

  const TRANS_LABEL: Record<string, string> = { none: '直接拼接', crossfade: '交叉淡化', fade: '黑场过渡' }

  const startEdit = (w: SeriesWork) => { setEditingId(w.task_id); setDraftTitle(w.title) }
  const cancelEdit = () => { setEditingId(null); setDraftTitle('') }

  const commitEdit = async (w: SeriesWork) => {
    const title = draftTitle.trim()
    if (!title || title === w.title) { cancelEdit(); return }
    setBusyId(w.task_id)
    try {
      await dramaService.renameSeriesWork(w.task_id, title)
      setWorks(prev => prev.map(x => x.task_id === w.task_id ? { ...x, title } : x))
      setPlaying(prev => prev && prev.task_id === w.task_id ? { ...prev, title } : prev)
      cancelEdit()
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || '重命名失败')
    } finally { setBusyId(null) }
  }

  const removeWork = async (w: SeriesWork) => {
    if (!confirm(`确定删除作品「${w.title}」吗？此操作不可恢复。`)) return
    setBusyId(w.task_id)
    try {
      await dramaService.deleteSeriesWork(w.task_id)
      setWorks(prev => {
        const next = prev.filter(x => x.task_id !== w.task_id)
        setPlaying(cur => cur && cur.task_id === w.task_id ? (next[0] || null) : cur)
        return next
      })
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || '删除失败')
    } finally { setBusyId(null) }
  }

  const download = (w: SeriesWork) => {
    const safe = (w.title || '整剧成片').replace(/[\/\\:*?"<>|]/g, '_').trim() || '整剧成片'
    const link = document.createElement('a')
    link.href = googleService.getResultUrl(w.url)
    link.download = `${safe}.mp4`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 min-h-0">
        <div className="w-full min-w-[320px] max-w-5xl mx-auto space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-100 flex items-center gap-2"><Video className="w-4 h-4 text-indigo-400" />放映剧场</h2>
            <p className="text-[11px] text-gray-600 mt-1">上方影院放映当前作品，下方胶片库陈列本项目所有整剧成片；可编辑名称（决定下载文件名）、下载或删除。</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-600 text-xs gap-2"><Loader2 className="w-4 h-4 animate-spin" />加载中…</div>
          ) : error ? (
            <p className="text-[11px] text-red-400">{error}</p>
          ) : works.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Video className="w-12 h-12 text-gray-800 mb-3" />
              <p className="text-gray-500 text-sm mb-1">还没有合并成剧的作品</p>
              <p className="text-gray-700 text-xs">到「合并成剧」选集合并后，作品会展示在这里。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* ── 上侧：影院大屏 ── */}
              <div className="rounded-2xl border border-white/8 bg-gradient-to-b from-[#050509] to-black overflow-hidden shadow-[0_0_40px_-12px_rgba(99,102,241,0.35)]">
                {playing ? (
                  <>
                    <div className="flex items-center justify-center px-4 pt-4">
                      <video key={playing.task_id} src={googleService.getResultUrl(playing.url)} controls autoPlay
                        className="w-full max-h-[560px] rounded-lg bg-black" />
                    </div>
                    <div className="flex items-center justify-between px-5 py-3 border-t border-white/8 mt-4">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-100 truncate">{playing.title}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">{playing.episode_count} 集 · {TRANS_LABEL[playing.transition] || playing.transition}</p>
                      </div>
                      <button onClick={() => download(playing)}
                        className="flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors"><Download className="w-3.5 h-3.5" />下载</button>
                    </div>
                  </>
                ) : (
                  <div className="h-64 flex items-center justify-center text-gray-600 text-xs">请选择下方胶片库中的作品播放</div>
                )}
              </div>

              {/* ── 中部：剧本 ── */}
              {(() => {
                const scripted = episodes.filter(ep => (ep.script_text || '').trim())
                if (scripted.length === 0) return null
                return (
                  <div className="rounded-2xl border border-white/8 bg-[#0d0d15] overflow-hidden">
                    <button onClick={() => setScriptOpen(o => !o)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
                      <span className="flex items-center gap-2 text-[13px] font-medium text-gray-200">
                        <FileText className="w-4 h-4 text-indigo-400" />剧本
                        <span className="text-[10px] text-gray-600 font-normal">{projectName || '本剧'} · {scripted.length} 集</span>
                      </span>
                      <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${scriptOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {scriptOpen && (
                      <div className="px-4 pb-4 pt-1 space-y-4 max-h-[420px] overflow-y-auto border-t border-white/8">
                        {scripted.map(ep => (
                          <div key={ep.episode}>
                            <p className="text-[11px] font-medium text-indigo-300/90 mb-1.5">
                              第 {ep.episode} 集{ep.title ? ` · ${ep.title}` : ''}
                            </p>
                            <p className="text-[12px] leading-relaxed text-gray-400 whitespace-pre-wrap">{ep.script_text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── 下侧：胶片库 ── */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <Film className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-[11px] font-medium text-gray-400">胶片库</span>
                  <span className="text-[10px] text-gray-700">{works.length} 部</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {works.map(w => {
                    const on = playing?.task_id === w.task_id
                    const editing = editingId === w.task_id
                    const busy = busyId === w.task_id
                    return (
                      <div key={w.task_id}
                        className={`group relative flex-shrink-0 w-52 rounded-xl border overflow-hidden transition-colors ${on ? 'border-indigo-500/50 bg-indigo-500/[0.08]' : 'border-white/8 bg-[#0d0d15] hover:border-white/20'}`}>
                        {/* 胶片“片格”视觉 + 影片首帧缩略图（点击放映） */}
                        <button onClick={() => setPlaying(w)}
                          className="w-full aspect-video bg-black relative flex items-center justify-center border-b border-white/8 overflow-hidden">
                          {/* 首帧缩略图：定位到 0.1s 作为封面帧 */}
                          <video
                            src={`${googleService.getResultUrl(w.url)}#t=0.1`}
                            preload="metadata" muted playsInline
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          <span className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-[repeating-linear-gradient(to_bottom,transparent_0_4px,rgba(255,255,255,0.12)_4px_8px)]" />
                          <span className="pointer-events-none absolute inset-y-0 right-0 w-2 bg-[repeating-linear-gradient(to_bottom,transparent_0_4px,rgba(255,255,255,0.12)_4px_8px)]" />
                          {/* 播放悬浮态 */}
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="w-9 h-9 rounded-full bg-black/50 backdrop-blur flex items-center justify-center"><Video className="w-4 h-4 text-white" /></span>
                          </span>
                          {on && <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/40 text-indigo-100 backdrop-blur">放映中</span>}
                        </button>

                        <div className="p-2.5 space-y-2">
                          {editing ? (
                            <div className="flex items-center gap-1">
                              <input autoFocus value={draftTitle}
                                onChange={e => setDraftTitle(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') commitEdit(w); if (e.key === 'Escape') cancelEdit() }}
                                className="flex-1 min-w-0 bg-black/40 border border-indigo-500/40 rounded px-1.5 py-1 text-[11px] text-gray-100 focus:outline-none" />
                              <button onClick={() => commitEdit(w)} disabled={busy}
                                className="p-1 text-emerald-400 hover:text-emerald-300 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}</button>
                              <button onClick={cancelEdit} className="p-1 text-gray-500 hover:text-gray-300"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          ) : (
                            <p className="text-[11px] text-gray-200 truncate" title={w.title}>{w.title}</p>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-600 truncate">{w.episode_count} 集 · {TRANS_LABEL[w.transition] || w.transition}</span>
                            {!editing && (
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                <button onClick={() => startEdit(w)} title="重命名"
                                  className="p-1 text-gray-500 hover:text-gray-200"><Pencil className="w-3.5 h-3.5" /></button>
                                <button onClick={() => download(w)} title="下载"
                                  className="p-1 text-gray-500 hover:text-gray-200"><Download className="w-3.5 h-3.5" /></button>
                                <button onClick={() => removeWork(w)} disabled={busy} title="删除"
                                  className="p-1 text-gray-500 hover:text-red-400 disabled:opacity-50">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 手风琴步骤面板 ──
 * 每个步骤为可折叠面板：根据完成状态切换突出显示；激活步骤展开编辑区域。
 * 最终「生成成片」步骤单独以高亮边框突出展示。 */
function AccordionStep({ step, order, active, done, reachable, locked, highlight, meta, badge, onToggle, children }: {
  step: { key: SubView; label: string; icon: typeof FileText }
  order: number; active: boolean; done: boolean; reachable: boolean
  locked: boolean; highlight?: boolean; meta?: string; badge?: boolean
  onToggle: () => void; children: ReactNode
}) {
  const Icon = step.icon
  const can = reachable && !locked
  // 面板外框：激活＞高亮(成片)＞已完成＞普通；不可达置灰
  const frame = active
    ? (highlight ? 'border-purple-500/50 bg-purple-500/[0.06] shadow-lg shadow-purple-900/20' : 'border-indigo-500/40 bg-indigo-500/[0.05]')
    : highlight
      ? 'border-purple-500/25 bg-[#0d0d15] hover:border-purple-500/40'
      : done
        ? 'border-green-500/20 bg-[#0d0d15] hover:border-green-500/30'
        : 'border-white/8 bg-[#0d0d15] hover:border-white/15'
  return (
    <div className={`rounded-2xl border transition-all ${frame} ${!can && !active ? 'opacity-60' : ''}`}>
      <button onClick={onToggle} disabled={!can && !active}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left ${can || active ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
          active ? (highlight ? 'bg-purple-500/30 text-purple-200' : 'bg-indigo-500/30 text-indigo-200')
          : done ? 'bg-green-500/20 text-green-300'
          : can ? 'bg-white/8 text-gray-400' : 'bg-white/5 text-gray-600'}`}>
          {done ? <Check className="w-3.5 h-3.5" /> : !can && !active ? <Lock className="w-3 h-3" /> : <Icon className="w-3.5 h-3.5" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${
              active ? (highlight ? 'text-purple-100' : 'text-indigo-100')
              : done ? 'text-green-200' : can ? 'text-gray-200' : 'text-gray-500'}`}>
              {order}. {step.label}
            </span>
            {highlight && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">成片</span>}
            {badge && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold animate-pulse flex items-center gap-0.5">
                <AlertCircle className="w-2.5 h-2.5" />有更新
              </span>
            )}
            {meta && <span className="text-[10px] text-gray-600">{meta}</span>}
            {done && !active && <span className="text-[10px] text-green-500/70">已完成</span>}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${active ? 'rotate-180 text-gray-300' : 'text-gray-600'}`} />
      </button>
      {active && (
        <div className="px-4 pb-4 pt-1 border-t border-white/5">
          {children}
        </div>
      )}
    </div>
  )
}

/* ── 时长选择弹窗 ── */
function DurationModal({ value, onChange, onConfirm, onCancel }: {
  value: number; onChange: (n: number) => void; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d0d15] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-gray-100 flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400" />选择每镜时长</h3>
          <button onClick={onCancel} className="text-gray-600 hover:text-gray-300"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] text-gray-500 mb-4">将按此时长拆分本集全部分镜，并自动草拟每镜时间段（之后仍可逐镜微调）。</p>
        <div className="grid grid-cols-5 gap-2 mb-5">
          {DURATION_OPTIONS.map(d => (
            <button key={d} onClick={() => onChange(d)}
              className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                value === d ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40' : 'bg-white/[0.03] text-gray-400 border-white/8 hover:bg-white/[0.06]'}`}>
              {d}s
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-white/10">取消</button>
          <button onClick={onConfirm}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90">
            <Clapperboard className="w-3.5 h-3.5" />拆分并草拟
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── 剧本视图 ── */
function ScriptView({ ep, locked, onTitle, onScript, onParse }: {
  ep: DramaEpisode; locked: boolean
  onTitle: (t: string) => void; onScript: (s: string) => void; onParse: () => void
}) {
  const hasShots = ep.shots.length > 0
  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState('')

  // 一键润色：把整段剧本交 AI 润色后回填（保留分段结构，不改写语言）
  const polishScript = async () => {
    if (polishing || locked || !ep.script_text?.trim()) return
    setPolishing(true); setPolishError('')
    try {
      const polished = await dramaService.polishText(ep.script_text, 'script')
      if (polished?.trim()) onScript(polished)
    } catch (err: any) {
      setPolishError(err?.response?.data?.detail || err?.message || 'AI 润色失败')
    } finally {
      setPolishing(false)
    }
  }

  return (
    <div className="space-y-4 pt-3">
      <div>
        <label className="text-[11px] text-gray-500 font-medium">本集标题</label>
        <input value={ep.title} onChange={e => onTitle(e.target.value)} disabled={locked}
          placeholder={`第${ep.episode}集（默认名，命名后覆盖）`}
          className="mt-1 w-full bg-[#14141c] border border-white/8 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 disabled:opacity-50" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1 gap-2">
          <label className="text-[11px] text-gray-500 font-medium">剧本（主线）</label>
          <div className="flex items-center gap-1.5">
            <button onClick={polishScript} disabled={locked || polishing || !ep.script_text?.trim()}
              title="AI 一键润色整段剧本（保留分段结构）"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.04] text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/15 disabled:opacity-40">
              {polishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{polishing ? '润色中…' : '一键润色'}
            </button>
            <button onClick={onParse} disabled={locked || !ep.script_text?.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-40">
              {hasShots ? <RotateCcw className="w-3.5 h-3.5" /> : <Clapperboard className="w-3.5 h-3.5" />}{hasShots ? '重新拆分分镜' : '拆分分镜'}
            </button>
          </div>
        </div>
        {polishError && <p className="mb-1 text-[11px] text-red-400">{polishError}</p>}
        <textarea value={ep.script_text} onChange={e => onScript(e.target.value)} disabled={locked}
          placeholder={'在此编写本集剧本……\n\n空行分隔，每段自动拆解为一个分镜。\n\n【写明时间分镜时，会逐字按区隔填充，不改写你的文字】\n例：\n全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。第一人称视角果茶宣传广告。\n首帧为图片1，你的手摘下一颗带晨露的红苹果，轻脆的苹果碰撞声；\n2-4 秒：快速切镜，投入雪克杯用力摇晃，背景音「鲜切现摇」；\n4-6 秒：成品特写，分层果茶倒入透明杯；\n6-8 秒：手持举杯递到镜头前，尾帧定格为图片2。'}
          className="w-full min-h-[52vh] bg-[#14141c] border border-white/8 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 resize-y leading-relaxed disabled:opacity-50" />
        <p className="mt-2 text-[11px] text-gray-600">
          当前 {ep.shots.length} 个分镜。{hasShots && <span className="text-amber-400/80">本集已拆分，重新拆分会覆盖现有分镜设计（会先确认）。</span>}「拆分分镜」会先选每镜时长：写明了时间分镜（首帧/2-4秒/尾帧…）的段落会逐字按区隔填充、不改写；其余段落才交 AI 草拟时间段。创意描述将作为该段一个或多个分镜的整体基础。
        </p>
      </div>
    </div>
  )
}

/* ── 重新拆分确认弹窗（防止覆盖已设计分镜） ── */
function ResplitConfirmModal({ shotCount, onConfirm, onCancel }: {
  shotCount: number; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-amber-500/25 bg-[#0d0d15] p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-gray-100 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-400" />确认重新拆分？</h3>
          <button onClick={onCancel} className="text-gray-600 hover:text-gray-300"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[12px] text-gray-400 leading-relaxed mb-5">
          本集已有 <span className="text-amber-300 font-semibold">{shotCount}</span> 个分镜。重新拆分将<span className="text-amber-300">丢弃当前所有分镜的时间段、素材与设计</span>，并按剧本重新生成。此操作不可撤销。
        </p>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-white/10">保留现有分镜</button>
          <button onClick={onConfirm}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30">
            <RotateCcw className="w-3.5 h-3.5" />覆盖并重新拆分
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── 整集创意描述（只读 + 始终可滚动；内层留白确保滚动到顶部行内容完整显示） ── */
function EpisodeGlobalDesc({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-indigo-500/15 bg-indigo-500/[0.04] p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-[11px] font-semibold text-indigo-300">整集创意描述（对应本集所有分镜）</span>
      </div>
      {/* 滚动框：内层 py 留白，避免 leading-relaxed 首行/末行被容器边缘裁切 */}
      <div className="w-full max-h-48 overflow-y-auto rounded-lg bg-black/20 border border-white/5">
        <div className="px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words text-gray-300">
          {text}
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-gray-600 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" />只读，如需修改请点上方「编辑剧本」。
      </p>
    </div>
  )
}

/* ── 整集级全局选项 + 素材库 ── */
function EpisodeGlobalOptions({ ep, dramaProjectId, disabled, onPatchEp }: {
  ep: DramaEpisode; dramaProjectId: string; disabled?: boolean
  onPatchEp: (patch: Partial<DramaEpisode>) => void
}) {
  const [uploading, setUploading] = useState<'image' | 'video' | 'audio' | null>(null)
  const [err, setErr] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadType = useRef<'image' | 'video' | 'audio'>('image')

  const assets = ep.assets ?? []
  const imageAssets = assets.filter(a => a.type === 'image')
  const videos = assets.filter(a => a.type === 'video')
  const audios = assets.filter(a => a.type === 'audio')
  const appliedImageCount = imageAssets.filter(a => a.key && a.applyToAll !== false).length

  const pick = (type: 'image' | 'video' | 'audio') => {
    if (disabled) return
    uploadType.current = type
    if (uploadRef.current) {
      uploadRef.current.accept = type === 'video' ? 'video/*' : type === 'audio' ? 'audio/*' : 'image/*'
      uploadRef.current.click()
    }
  }
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; const type = uploadType.current
    if (!file) { e.target.value = ''; return }
    setUploading(type); setErr('')
    try {
      const { object_key, filename } = await dramaService.uploadAsset(file, dramaProjectId, type)
      const asset: EpisodeAsset = { id: genId(), key: object_key, name: filename, label: '', type }
      onPatchEp({ assets: [...assets, asset] })
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || '素材上传失败')
    } finally { setUploading(null); e.target.value = '' }
  }
  const updateAsset = (id: string, patch: Partial<EpisodeAsset>) =>
    onPatchEp({ assets: assets.map(a => (a.id === id ? { ...a, ...patch } : a)) })
  // 从配置选取：追加图片素材（角色默认带入全部四视图，各附标题描述；默认全局应用到所有分镜）
  const onPickFromConfig = (sels: { key: string; label: string; caption?: string; desc: string; name: string; assetId: string; assetType: 'character' | 'scene' | 'prop' }[]) => {
    setShowPicker(false)
    if (!sels.length) return
    const newAssets: EpisodeAsset[] = sels.map(sel => ({
      id: genId(), key: sel.key, name: sel.name, label: sel.caption || sel.label, type: 'image' as const,
      desc: sel.desc, assetId: sel.assetId, assetType: sel.assetType, applyToAll: true,
    }))
    onPatchEp({ assets: [...assets, ...newAssets] })
  }
  const removeAsset = (id: string) => {
    const a = assets.find(x => x.id === id)
    const patch: Partial<DramaEpisode> = { assets: assets.filter(x => x.id !== id) }
    // 若被删素材正被 BGM 关联，一并清除关联
    if (a && a.type === 'audio' && ep.bgm?.key === a.key) patch.bgm = undefined
    onPatchEp(patch)
  }

  const assetIcon = (t: EpisodeAsset['type']) =>
    t === 'video' ? <Video className="w-3 h-3 text-blue-400" /> : t === 'audio' ? <Music className="w-3 h-3 text-green-400" /> : <ImageIcon className="w-3 h-3 text-indigo-400" />

  const inputCls = "w-full bg-[#06060e] border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 disabled:opacity-50"

  return (
    <div className="rounded-xl border border-indigo-500/15 bg-indigo-500/[0.04] p-3 space-y-3">
      <input ref={uploadRef} type="file" className="hidden" onChange={onFile} />
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-[11px] font-semibold text-indigo-300">整集全局设定（对应本集所有分镜，可关联素材文件按名称代入提示词）</span>
      </div>

      {/* 全局选项 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500">人称定义</label>
          <select value={ep.narration || ''} disabled={disabled}
            onChange={e => onPatchEp({ narration: e.target.value })} className={inputCls}>
            <option value="">不指定</option>
            <option value="第一人称">第一人称</option>
            <option value="第三人称">第三人称</option>
            <option value="旁白">旁白</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">构图视角</label>
          <input value={ep.composition || ''} disabled={disabled}
            onChange={e => onPatchEp({ composition: e.target.value })}
            placeholder="如：手持运镜 / 俯拍" className={inputCls} list={`comp-${ep.episode}`} />
          {videos.length > 0 && (
            <datalist id={`comp-${ep.episode}`}>
              {videos.map(v => <option key={v.id} value={`参考视频「${v.label || v.name}」的构图`} />)}
            </datalist>
          )}
        </div>
        <div>
          <label className="text-[10px] text-gray-500">背景音乐</label>
          <select value={ep.bgm?.key || ''} disabled={disabled}
            onChange={e => {
              const a = audios.find(x => x.key === e.target.value)
              onPatchEp({ bgm: a ? { key: a.key, label: a.label || a.name } : undefined })
            }} className={inputCls}>
            <option value="">不指定</option>
            {audios.map(a => <option key={a.id} value={a.key}>{a.label || a.name}</option>)}
          </select>
        </div>
      </div>

      {/* 整集素材库 */}
      <div>
        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
          <span className="text-[10px] text-gray-500">
            整集素材库（图片可设为全局参考图自动代入所有分镜；视频/音频命名后在上方关联）
            {appliedImageCount > 0 && <span className="ml-1 text-indigo-300">· 已全局应用 {appliedImageCount} 张图片（图片1..{appliedImageCount}）</span>}
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowPicker(true)} disabled={disabled || !!uploading}
              title="从「配置」里的角色/场景/道具选取，自动带上命名与形象特征描述并全局应用"
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/20 hover:bg-purple-500/25 disabled:opacity-40">
              <Library className="w-3 h-3" />从配置选取
            </button>
            <button onClick={() => pick('image')} disabled={disabled || !!uploading}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-white/[0.04] text-gray-300 border border-white/10 hover:bg-white/[0.08] disabled:opacity-40">
              {uploading === 'image' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}图片
            </button>
            <button onClick={() => pick('video')} disabled={disabled || !!uploading}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-white/[0.04] text-gray-300 border border-white/10 hover:bg-white/[0.08] disabled:opacity-40">
              {uploading === 'video' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}视频
            </button>
            <button onClick={() => pick('audio')} disabled={disabled || !!uploading}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-white/[0.04] text-gray-300 border border-white/10 hover:bg-white/[0.08] disabled:opacity-40">
              {uploading === 'audio' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Music className="w-3 h-3" />}音频
            </button>
          </div>
        </div>
        {err && <p className="text-[10px] text-red-400 mb-1">{err}</p>}
        {assets.length === 0 ? (
          <p className="text-[10px] text-gray-600 py-1">还没有素材。上传图片可设为全局参考图自动代入所有分镜；视频/音频命名后可在「构图视角/背景音乐」中关联。</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {assets.map(a => {
              // 图片资产：序号 = 在「已应用的图片资产」中的位置（图片1..G），与分镜里代入序号一致
              const globalNo = a.type === 'image' && a.applyToAll !== false
                ? imageAssets.filter(x => x.applyToAll !== false).findIndex(x => x.id === a.id) + 1
                : 0
              return a.type === 'image' ? (
                <div key={a.id} className="rounded-md bg-[#14141c] border border-white/8 px-2 py-1.5 flex flex-col gap-1.5">
                  {a.key
                    ? <button type="button" onClick={() => setPreviewAssetId(a.id)}
                        title="点击查看原图 / 编辑标题描述"
                        className="relative group/thumb w-full h-28 rounded-md overflow-hidden border border-white/10 bg-black/30">
                        <AssetThumb objectKey={a.key} className="w-full h-full object-contain" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/40 transition-colors opacity-0 group-hover/thumb:opacity-100">
                          <Maximize2 className="w-4 h-4 text-white/90" />
                        </span>
                      </button>
                    : <div className="w-full h-28 rounded-md bg-black/30 flex items-center justify-center"><ImageIcon className="w-6 h-6 text-gray-600" /></div>}
                  <div className="flex items-center gap-1.5">
                    {assetIcon(a.type)}
                    {globalNo > 0 && <span className="px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[9px] flex-shrink-0">图片{globalNo}</span>}
                    {a.assetType && GLOBAL_ASSET_SRC[a.assetType] && (() => {
                      const S = GLOBAL_ASSET_SRC[a.assetType!]
                      return (
                        <span title={`来自配置·${S.label}`}
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[9px] flex-shrink-0">
                          <S.icon className="w-2.5 h-2.5" />{S.label}
                        </span>
                      )
                    })()}
                    <input value={a.label || ''} disabled={disabled}
                      onChange={e => updateAsset(a.id, { label: e.target.value })}
                      placeholder={a.name || '图片名称（如：红苹果）'}
                      className="flex-1 min-w-0 bg-transparent text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none" />
                    <button onClick={() => removeAsset(a.id)} disabled={disabled} className="text-gray-600 hover:text-red-400 disabled:opacity-40"><X className="w-3 h-3" /></button>
                  </div>
                  {/* 首帧/尾帧（与分镜内图片一致） */}
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => updateAsset(a.id, { frame: a.frame === 'first' ? undefined : 'first' })} disabled={disabled}
                      className={`flex-1 px-1.5 py-1 rounded-md text-[10px] border transition-colors disabled:opacity-40 ${a.frame === 'first' ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50' : 'bg-white/[0.03] text-gray-500 border-white/8 hover:text-gray-300'}`}>首帧</button>
                    <button onClick={() => updateAsset(a.id, { frame: a.frame === 'last' ? undefined : 'last' })} disabled={disabled}
                      className={`flex-1 px-1.5 py-1 rounded-md text-[10px] border transition-colors disabled:opacity-40 ${a.frame === 'last' ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50' : 'bg-white/[0.03] text-gray-500 border-white/8 hover:text-gray-300'}`}>尾帧</button>
                  </div>
                  {/* 用途/视角：代入「全程使用图片N…」一行 */}
                  <input value={a.usage || ''} disabled={disabled}
                    onChange={e => updateAsset(a.id, { usage: e.target.value })}
                    placeholder="用途/视角（如：第一视角构图）→ 全程使用图片N…"
                    className="w-full bg-[#06060e] border border-white/10 rounded-md px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 disabled:opacity-50" />
                  {/* 形态/特征描述：配置选取自动带入，可手改；非空才代入「形象特征」提示词行 */}
                  <textarea value={a.desc || ''} disabled={disabled} rows={2}
                    onChange={e => updateAsset(a.id, { desc: e.target.value })}
                    placeholder="形态/特征描述（选填，代入提示词保证外观一致）"
                    className="w-full bg-[#06060e] border border-purple-500/15 rounded-md px-2 py-1 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-400/40 resize-none disabled:opacity-50" />
                  {/* 应用到所有分镜开关（缺省视为开） */}
                  <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer select-none">
                    <input type="checkbox" checked={a.applyToAll !== false} disabled={disabled}
                      onChange={e => updateAsset(a.id, { applyToAll: e.target.checked })}
                      className="accent-indigo-500" />
                    应用到所有分镜（自动作为参考图，满足每镜参考图必填）
                  </label>
                </div>
              ) : (
                <div key={a.id} className="flex items-center gap-1.5 rounded-md bg-[#14141c] border border-white/8 px-2 py-1.5">
                  {assetIcon(a.type)}
                  <input value={a.label || ''} disabled={disabled}
                    onChange={e => updateAsset(a.id, { label: e.target.value })}
                    placeholder={a.name || '素材名称'}
                    className="flex-1 min-w-0 bg-transparent text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none" />
                  <button onClick={() => removeAsset(a.id)} disabled={disabled} className="text-gray-600 hover:text-red-400 disabled:opacity-40"><X className="w-3 h-3" /></button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showPicker && (
        <AssetPickerModal projectId={dramaProjectId}
          onClose={() => setShowPicker(false)} onPick={onPickFromConfig} />
      )}
      {previewAssetId && (() => {
        const a = assets.find(x => x.id === previewAssetId)
        if (!a || !a.key) return null
        return (
          <AssetPreviewModal kind="image" objectKey={a.key} name={a.name}
            label={a.label} desc={a.desc} editable
            onSave={(patch) => updateAsset(a.id, patch)}
            onClose={() => setPreviewAssetId(null)} />
        )
      })()}
    </div>
  )
}

/* ── 拆分分镜详情视图（二级视图） ── */
function StoryboardView({ ep, dramaProjectId, aspect, onPatchShot, onPatchEp, onAddShot, onRemoveShot, onNext, onReSplit, onBackToScript, epReady, notReadyCount, bulkDrafting, draftProgress, rendering, storyboardError }: {
  ep: DramaEpisode; dramaProjectId: string; aspect: string
  onPatchShot: (id: string, patch: Partial<EpisodeShot>) => void
  onPatchEp: (patch: Partial<DramaEpisode>) => void
  onAddShot: () => void; onRemoveShot: (id: string) => void
  onNext: () => void; onReSplit: () => void; onBackToScript: () => void
  epReady: boolean; notReadyCount: number
  bulkDrafting: boolean; draftProgress: { done: number; total: number }
  rendering: boolean; storyboardError: string
}) {
  const busy = bulkDrafting
  // 整集全局应用图片（图片1..G）：传入每个分镜编辑器只读展示，并把自有图片编号顺延到 G+1
  const globalImages = appliedGlobalImages(ep)
  // 删除本分镜二次确认：记录待确认的分镜 id（防误删）
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-600">每个镜头需配齐：时间段分镜 + 至少 1 张角色/事物参考图（生成的硬性前置）。创意描述只读，如需改文字请返回「编写剧本」。</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onBackToScript} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10 disabled:opacity-40">
            <ArrowLeft className="w-3.5 h-3.5" />编辑剧本
          </button>
          <button onClick={onReSplit} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10 disabled:opacity-40">
            <RotateCcw className="w-3.5 h-3.5" />重新拆分
          </button>
          <button onClick={onAddShot} disabled={busy} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" />加分镜
          </button>
          <button onClick={onNext} disabled={!epReady || busy}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            下一步<ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {bulkDrafting && (
        <p className="text-[11px] text-indigo-300 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />正在 AI 草拟时间段… {draftProgress.done}/{draftProgress.total}
        </p>
      )}
      {storyboardError && <p className="text-[11px] text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{storyboardError}</p>}
      {!busy && !epReady && ep.shots.length > 0 && (
        <p className="text-[11px] text-amber-400/80 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />还有 {notReadyCount} 个镜头未配齐（缺图或缺时间段），配齐后才能进入下一步。
        </p>
      )}

      {/* 整集全局选项：构图视角 / 人称定义 / 背景音乐 + 整集素材库（关联文件，按名称代入提示词） */}
      <EpisodeGlobalOptions ep={ep} dramaProjectId={dramaProjectId} disabled={busy || rendering} onPatchEp={onPatchEp} />

      {/* 整集创意描述（共享，对应所有分镜，只读完整展示；改文字回「编写剧本」） */}
      {(ep.global_desc || '').trim() && (
        <EpisodeGlobalDesc text={ep.global_desc!} />
      )}

      {ep.shots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Clapperboard className="w-12 h-12 text-gray-800 mb-3" />
          <p className="text-gray-500 text-sm mb-1">本集还没有分镜</p>
          <p className="text-gray-700 text-xs">回到「编写剧本」后点「拆分分镜」选择时长，或点上方「加分镜」手动添加。</p>
        </div>
      ) : (
        ep.shots.map(shot => {
          return (
          <div key={shot.id} className="rounded-2xl border border-white/8 bg-[#0d0d15] p-3">
            <div className="flex items-center justify-between mb-2 px-1 gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="w-5 h-5 flex-shrink-0 rounded bg-indigo-500/15 text-indigo-300 text-[10px] flex items-center justify-center">{shot.index}</span>
                <input value={shot.title || ''} disabled={busy}
                  onChange={e => onPatchShot(shot.id, { title: e.target.value })}
                  placeholder={`分镜 ${shot.index}`}
                  className="min-w-0 flex-1 max-w-xs bg-transparent text-xs font-semibold text-gray-200 placeholder-gray-500 border-b border-transparent hover:border-white/10 focus:border-indigo-500/40 focus:outline-none py-0.5 disabled:opacity-50" />
              </div>
              <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-gray-500" title="本镜总时长 = 各时间段时长累加，调整下方时间段时长即可改变">
                总时长
                <span className="text-gray-300 font-medium">{shotTotalDuration(shot)}s</span>
              </span>
              {confirmDeleteId === shot.id ? (
                <span className="flex-shrink-0 flex items-center gap-1">
                  <button onClick={() => { setConfirmDeleteId(null); onRemoveShot(shot.id) }} disabled={busy}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40">确认删除</button>
                  <button onClick={() => setConfirmDeleteId(null)}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-500 hover:bg-white/10">取消</button>
                </span>
              ) : (
                <button onClick={() => setConfirmDeleteId(shot.id)} disabled={busy || ep.shots.length <= 1}
                  title={ep.shots.length <= 1 ? '每集至少保留一个分镜' : '删除本分镜'}
                  className="flex-shrink-0 text-gray-600 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-600"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
            <ShotStoryboardEditor shot={shot} dramaProjectId={dramaProjectId} aspect={aspect}
              globalImages={globalImages}
              onUpdate={p => onPatchShot(shot.id, p)} disabled={rendering || busy} />
          </div>
          )
        })
      )}
    </div>
  )
}

/* ── 单镜剧创提示词卡片（可展开 API 请求体，含真实可访问 URL） ── */
function ShotPromptCard({ shot, aspect, ep }: { shot: EpisodeShot; aspect: string; ep: DramaEpisode }) {
  const [showPayload, setShowPayload] = useState(false)
  const [realPayload, setRealPayload] = useState<Record<string, unknown> | null>(null)
  const [payloadLoading, setPayloadLoading] = useState(false)
  const [payloadError, setPayloadError] = useState('')
  const episodeGlobal = ep.global_desc || ''
  // 有效图片 = 整集全局应用图片（图片1..G） + 本镜自有图片；序号与生成链路一致
  const images = effectiveShotImages(ep, shot)
  const hasVideo = !!shot.reference_video_key
  const hasAudio = !!shot.audio_key
  // 音频/BGM：本镜自有优先，否则用整集 BGM（与生成链路一致）
  const audioLabel = shot.audio_key ? shot.audio_label : ep.bgm?.label
  const hasAnyAudio = hasAudio || !!ep.bgm?.key
  // 展示提示词：与生成链路 / 变更检测同款确定性基线（buildShotBaseline）
  const prompt = buildShotBaseline(ep, shot)

  // 展开请求体：向后端取真实签名 proxy URL（前端无 SECRET_KEY 无法自行签名）
  const togglePayload = async () => {
    const next = !showPayload
    setShowPayload(next)
    if (next && !realPayload && !payloadLoading) {
      setPayloadLoading(true); setPayloadError('')
      try {
        const res = await dramaService.previewPayload({
          global_desc: [episodeGlobal, shot.global_desc].map(x => (x || '').trim()).filter(Boolean).join('\n'),
          beats: (shot.beats ?? []).map(b => ({ time: b.time, action: b.action, shotSize: b.shotSize })),
          images: images.map(im => ({ key: im.key, label: im.label, frame: im.frame, usage: im.usage, desc: im.desc, name: im.name, assetType: im.assetType })),
          reference_video_key: shot.reference_video_key,
          reference_video_label: shot.reference_video_label,
          audio_key: shot.audio_key || ep.bgm?.key,
          audio_label: audioLabel,
          composition: ep.composition,
          narration: ep.narration,
          aspect_ratio: aspect,
          duration: shot.duration || 5,
        })
        setRealPayload(res.payload)
      } catch (e: any) {
        setPayloadError(e?.response?.data?.detail || e?.message || '获取请求体失败')
      } finally {
        setPayloadLoading(false)
      }
    }
  }
  return (
    <div className="rounded-2xl border border-white/8 bg-[#0d0d15] p-3">
      <div className="flex items-center justify-between mb-2 px-1 gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-200 flex items-center gap-2">
          <span className="w-5 h-5 rounded bg-indigo-500/15 text-indigo-300 text-[10px] flex items-center justify-center">{shot.index}</span>
          分镜 {shot.index}
          <span className="text-[10px] text-gray-600 font-normal">{shot.duration || 5}s · {images.length}图{hasVideo ? ' · 视频' : ''}{hasAnyAudio ? ' · 音频' : ''}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button onClick={togglePayload}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-white/[0.04] text-gray-400 hover:text-gray-200 border border-white/8">
            <FileJson className="w-3 h-3" />{showPayload ? '隐藏请求体' : 'API 请求体'}
          </button>
        </div>
      </div>
      {/* 只读展示确定性提示词（与生成链路一致） */}
      <pre className="w-full min-h-[26rem] bg-[#14141c] border border-white/8 rounded-xl px-4 py-3 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap font-mono overflow-y-auto">
        {prompt || '（该镜未配置创意/时间段）'}
      </pre>
      {showPayload && (
        <>
          <p className="mt-2 text-[10px] text-gray-600">提交给 Seedance 2.0 视频接口的请求体；图片/视频/音频均为真实可访问的 proxy URL（/api/v1/drama/ref-asset，带签名与有效期）。</p>
          {payloadError && <p className="mt-1 text-[11px] text-red-400">{payloadError}</p>}
          <pre className="mt-1 w-full min-h-[26rem] bg-[#14141c] border border-white/8 rounded-xl px-4 py-3 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap font-mono overflow-y-auto">
            {payloadLoading ? '加载中…（正在生成真实可访问 URL）' : realPayload ? JSON.stringify(realPayload, null, 2) : ''}
          </pre>
        </>
      )}
    </div>
  )
}

/* ── 合并成片：① 合并分镜里生成各分镜视频 → ② 合并（A=ffmpeg拼接任意时长 / B=Seedance生成≤12s） ── */
function MergeFinalPanel({ ep, aspect, projectId, rendering, onGenerateShots, onMergeComplete }: {
  ep: DramaEpisode; aspect: string; projectId: string; rendering: boolean
  onGenerateShots: (shotIds?: string[]) => void; onMergeComplete: (url: string) => void
}) {
  const STATUS_LABEL: Record<string, string> = {
    idle: '待生成', pending: '排队中', processing: '生成中', completed: '已完成', failed: '失败',
  }
  const allShots = ep.shots ?? []
  const shotById = new Map(allShots.map(s => [s.id, s]))

  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<'concat' | 'seedance'>('concat')
  const [order, setOrder] = useState<string[]>(allShots.map(s => s.id))      // 成片顺序（分镜 id）
  const [selected, setSelected] = useState<Set<string>>(new Set(allShots.map(s => s.id)))
  const [aspectRatio, setAspectRatio] = useState(aspect)
  const [duration, setDuration] = useState(8)
  const [mergePrompt, setMergePrompt] = useState(ep.global_desc || '')
  const [beats, setBeats] = useState<Beat[]>(defaultBeats(8))
  const [drafting, setDrafting] = useState(false)

  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState('')
  const [promptOpen, setPromptOpen] = useState<Set<string>>(new Set())   // 展开剧创提示词的分镜

  // 生成中分镜的视频位 DOM 引用：进入生成态时自动滚动到该镜，展示转圈等待
  const shotSlotRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const scrolledRef = useRef<string | null>(null)
  const generatingId = (ep.shots ?? []).find(s => s.videoStatus === 'pending' || s.videoStatus === 'processing')?.id ?? null
  useEffect(() => {
    if (generatingId && scrolledRef.current !== generatingId) {
      shotSlotRefs.current[generatingId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      scrolledRef.current = generatingId
    }
    if (!generatingId) scrolledRef.current = null
  }, [generatingId])

  const [showPayload, setShowPayload] = useState(false)
  const [realPayload, setRealPayload] = useState<Record<string, unknown> | null>(null)
  const [payloadLoading, setPayloadLoading] = useState(false)
  const [payloadError, setPayloadError] = useState('')

  const invalidate = () => setRealPayload(null)

  // 选中且按序的分镜（用于合并）
  const selectedShots = order.map(id => shotById.get(id)).filter(
    (s): s is EpisodeShot => !!s && selected.has(s.id),
  )
  const completedSelected = selectedShots.filter(s => s.videoStatus === 'completed' && s.videoTaskId)
  const mergeTaskIds = completedSelected.map(s => s.videoTaskId!)
  const allSelectedReady = selectedShots.length > 0 && selectedShots.every(s => s.videoStatus === 'completed' && s.videoTaskId)
  const selectedDuration = selectedShots.reduce((sum, s) => sum + shotTotalDuration(s), 0)
  const overCap = mode === 'seedance' && selectedDuration > 12
  const pendingCount = allShots.filter(s => s.videoStatus !== 'completed').length
  // 已出成片但提示词之后被改的镜头数（分镜修改后需按最新提示词重绘）
  const staleCount = allShots.filter(s => videoNeedsRerender(ep, s)).length

  // 只有一个分镜：无需合并——成片即分镜1，锁定合并方式/提示词/合并按钮
  const singleShot = allShots.length === 1
  const soleShot = singleShot ? allShots[0] : null
  useEffect(() => {
    if (soleShot && soleShot.videoStatus === 'completed' && soleShot.videoTaskId) {
      const url = `/api/v1/google/task/${soleShot.videoTaskId}/file`
      if (ep.composite_url !== url) onMergeComplete(url)
    }
    // 仅在唯一分镜的视频任务/状态变化时触发；composite 写入由 onMergeComplete 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleShot?.videoTaskId, soleShot?.videoStatus])

  const toggleSel = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    invalidate()
  }
  const move = (idx: number, dir: -1 | 1) => {
    setOrder(prev => {
      const n = [...prev]; const j = idx + dir
      if (j < 0 || j >= n.length) return prev
      ;[n[idx], n[j]] = [n[j], n[idx]]; return n
    })
    invalidate()
  }

  const promptPreview = buildPrompt({
    global: mergePrompt,
    beats: mode === 'seedance' ? beats : [],
    images: [],
    video: mode === 'seedance' ? { label: '已生成分镜' } : null,
  })

  const previewArgs = () => ({
    mode, drama_project_id: projectId, episode_num: ep.episode, title: ep.title,
    aspect_ratio: aspectRatio, video_task_ids: mergeTaskIds, merge_prompt: mergePrompt,
    beats: mode === 'seedance' ? beats.map(b => ({ time: b.time, action: b.action })) : [],
    duration,
  })

  const togglePayload = async () => {
    const next = !showPayload
    setShowPayload(next)
    if (next && !realPayload && !payloadLoading) {
      setPayloadLoading(true); setPayloadError('')
      try {
        const res = await dramaService.composePreviewPayload(previewArgs())
        setRealPayload(res.payload)
      } catch (e: any) {
        setPayloadError(e?.response?.data?.detail || e?.message || '获取请求体失败')
      } finally {
        setPayloadLoading(false)
      }
    }
  }

  const draftBeats = async () => {
    setDrafting(true)
    try {
      const res = await dramaService.generateBeatScript({
        description: mergePrompt || ep.global_desc || ep.title || '把多段分镜衔接为连续短片',
        duration, aspect_ratio: aspectRatio,
      })
      if (res.global && !mergePrompt) setMergePrompt(res.global)
      if (res.beats?.length) setBeats(res.beats.map(b => ({ time: b.time, action: b.action, sfx: b.sfx, voice: b.voice })))
      invalidate()
    } catch (e: any) {
      setMergeError(e?.response?.data?.detail || e?.message || 'AI 草拟失败')
      setTimeout(() => setMergeError(''), 4000)
    } finally {
      setDrafting(false)
    }
  }

  const submit = async () => {
    if (mergeTaskIds.length === 0) { setMergeError('请先生成并选择至少 1 段分镜视频'); setTimeout(() => setMergeError(''), 4000); return }
    if (!allSelectedReady) { setMergeError('请先把所选分镜全部生成完成，再合并成片'); setTimeout(() => setMergeError(''), 4000); return }
    if (overCap) { setMergeError('生成式合并(模式B)总时长上限 12 秒，超出请改用拼接合并'); setTimeout(() => setMergeError(''), 5000); return }
    setMerging(true); setMergeError('')
    try {
      let taskId: string
      if (mode === 'concat') {
        const r = await dramaService.composeFinal({
          drama_project_id: projectId, episode_num: ep.episode, title: ep.title,
          aspect_ratio: aspectRatio, video_task_ids: mergeTaskIds, subtitle: mergePrompt,
        })
        taskId = r.task_id
      } else {
        // 模式 B：提示词以服务端拼装为准（与请求体预览同源）
        const pv = await dramaService.composePreviewPayload(previewArgs())
        const r = await dramaService.composeVideo({
          drama_project_id: projectId, prompt: pv.prompt, aspect_ratio: aspectRatio, duration,
          reference_shot_task_ids: mergeTaskIds, episode_num: ep.episode, as_episode_composite: true,
        })
        taskId = r.task_id
      }
      const task = await googleService.pollTaskStatus(taskId)
      if (task.status === 'completed') {
        onMergeComplete(`/api/v1/google/task/${taskId}/file`)
      } else {
        setMergeError(task.error || '合并失败')
      }
    } catch (e: any) {
      setMergeError(e?.response?.data?.detail || e?.message || '合并失败')
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="rounded-2xl border border-indigo-500/20 bg-[#0d0d15]">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3">
        <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5"><Scissors className="w-3.5 h-3.5" />合并成片</span>
        <span className="text-[10px] text-gray-500 flex items-center gap-1">
          {singleShot ? '单分镜' : `${mode === 'concat' ? '拼接合并' : '生成合并'} · 选 ${selectedShots.length}/${allShots.length} 镜`}
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* 分镜生成列表（生成各分镜视频；多分镜时可选择/排序后合并） */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-gray-300">
              {singleShot ? '生成分镜视频（单分镜自动作为本集成片）' : '生成各分镜视频，选择/排序后合并'}
            </span>
            {!singleShot && (
              <button onClick={() => onGenerateShots()} disabled={rendering || allShots.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 disabled:opacity-40">
                {rendering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clapperboard className="w-3 h-3" />}全部生成{pendingCount > 0 ? `（${pendingCount} 待生成）` : ''}
              </button>
            )}
          </div>
          {staleCount > 0 && (
            <p className="text-[11px] text-amber-300 flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/25 px-2.5 py-1.5">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              上一步提示词有变更：{staleCount} 个镜头的成片按旧提示词生成，请点对应镜头的「按最新重绘」更新{singleShot ? '。' : '，再合并成片。'}
            </p>
          )}
          <div className="space-y-1.5">
            {order.map((id, idx) => {
              const s = shotById.get(id)
              if (!s) return null
              const st = s.videoStatus || 'idle'
              const done = st === 'completed' && !!s.videoTaskId
              const stale = videoNeedsRerender(ep, s)
              const pOpen = promptOpen.has(id)
              return (
                <div key={id} className="rounded-lg bg-white/[0.03]">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  {!singleShot && <input type="checkbox" checked={selected.has(id)} onChange={() => toggleSel(id)} className="accent-indigo-500" />}
                  <span className="text-[11px] text-gray-300 flex-1 min-w-0">分镜 {s.index} <span className="text-gray-600">· {shotTotalDuration(s)}s</span></span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    st === 'completed' ? 'bg-green-500/15 text-green-400'
                    : st === 'failed' ? 'bg-red-500/15 text-red-400'
                    : st === 'processing' || st === 'pending' ? 'bg-indigo-500/15 text-indigo-300'
                    : 'bg-white/5 text-gray-500'}`}>{STATUS_LABEL[st] || st}</span>
                  {stale && (
                    <span title="上一步分镜/提示词已修改，当前成片按旧提示词生成，建议重绘"
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-medium flex items-center gap-0.5 animate-pulse">
                      <AlertCircle className="w-2.5 h-2.5" />提示词有变更
                    </span>
                  )}
                  <button onClick={() => setPromptOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${pOpen ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' : 'bg-white/[0.04] text-gray-400 border-white/8 hover:text-gray-200'}`}>
                    <FileJson className="w-3 h-3" />提示词
                  </button>
                  <button onClick={() => onGenerateShots([s.id])} disabled={rendering}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] disabled:opacity-30 border ${
                      stale ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25 font-medium'
                      : 'bg-white/[0.04] text-gray-400 border-transparent hover:text-gray-200'}`}>
                    <RotateCcw className="w-3 h-3" />{stale ? '按最新重绘' : done ? '重绘' : '生成'}
                  </button>
                  {!singleShot && <button onClick={() => move(idx, -1)} disabled={idx === 0} className="px-1.5 py-0.5 rounded text-[10px] bg-white/[0.04] text-gray-400 disabled:opacity-30">↑</button>}
                  {!singleShot && <button onClick={() => move(idx, 1)} disabled={idx === order.length - 1} className="px-1.5 py-0.5 rounded text-[10px] bg-white/[0.04] text-gray-400 disabled:opacity-30">↓</button>}
                </div>
                {st === 'failed' && (
                  <p className="px-2 pb-2 text-[10px] text-red-400/90 break-all">
                    失败原因：{s.videoError || '未返回具体原因，请查看后台日志或重试'}
                  </p>
                )}
                {pOpen && (
                  <div className="px-2 pb-2">
                    <ShotPromptCard shot={s} aspect={aspectRatio} ep={ep} />
                  </div>
                )}
                {/* 生成中：在视频位显示转圈等待占位；完成后同位置替换为影片 */}
                {(st === 'pending' || st === 'processing') && (
                  <div ref={el => { shotSlotRefs.current[id] = el }} className="px-2 pb-2">
                    <div className="w-full aspect-video max-h-56 rounded-md bg-black/40 border border-indigo-500/20 flex flex-col items-center justify-center gap-2 text-indigo-300">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <span className="text-[11px]">{st === 'pending' ? '排队中…' : '视频生成中…'}</span>
                    </div>
                  </div>
                )}
                {/* 该分镜生成的影片：直接放在本分镜栏下侧 */}
                {done && s.videoUrl && (
                  <div ref={el => { shotSlotRefs.current[id] = el }} className="px-2 pb-2">
                    <video src={googleService.getResultUrl(s.videoUrl)} controls className="w-full rounded-md bg-black max-h-56" />
                  </div>
                )}
                </div>
              )
            })}
          </div>

          {/* 单分镜无需合并：成片即分镜1（生成后由 useEffect 自动写入 composite） */}
          {singleShot && (
            <p className="text-[11px] text-gray-500 px-1">单分镜无需合并——成片即分镜1，生成分镜后自动作为本集成片。如需多段合并，请在「拆分分镜」增加镜头。</p>
          )}

          {/* 多分镜：合并配置 + 合并方式 + 提示词 + 合并按钮（平铺，无子块外壳） */}
          {!singleShot && (
          <>
          <div className="flex items-center gap-3">
            <label className="text-[10px] text-gray-500">画幅
              <select value={aspectRatio} onChange={e => { setAspectRatio(e.target.value); invalidate() }}
                className="ml-1 bg-[#0d0d15] border border-white/8 rounded px-2 py-1 text-[11px] text-gray-200">
                <option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option>
              </select>
            </label>
            <span className="text-[10px] text-gray-600">所选合计约 {selectedDuration}s</span>
          </div>

          {/* 合并方式 */}
          <div className="flex items-center gap-2">
            <button onClick={() => { setMode('concat'); invalidate() }}
              className={`px-3 py-1.5 rounded-lg text-[11px] border ${mode === 'concat' ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' : 'bg-white/[0.03] text-gray-400 border-white/8'}`}>
              拼接合并 · 任意时长
            </button>
            <button onClick={() => { setMode('seedance'); invalidate() }}
              className={`px-3 py-1.5 rounded-lg text-[11px] border ${mode === 'seedance' ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' : 'bg-white/[0.03] text-gray-400 border-white/8'}`}>
              生成合并 · ≤12s
            </button>
            {mode === 'seedance' && (
              <label className="text-[10px] text-gray-500 flex items-center gap-2 flex-1">时长 {duration}s
                <input type="range" min={3} max={12} value={duration}
                  onChange={e => { setDuration(Number(e.target.value)); invalidate() }} className="flex-1 accent-indigo-500" />
              </label>
            )}
          </div>
          {overCap && <p className="text-[10px] text-amber-400">所选分镜合计 {selectedDuration}s 超过生成式上限 12s——请减少分镜或改用「拼接合并」。</p>}

          {/* ── 合并成片提示词 ── */}
          <div className="rounded-xl border border-white/8 bg-[#14141c] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-300">合并成片提示词{mode === 'concat' ? '（字幕/备注）' : ''}</span>
              {mode === 'seedance' && (
                <button onClick={draftBeats} disabled={drafting}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-white/[0.04] text-gray-400 hover:text-gray-200 border border-white/8 disabled:opacity-40">
                  {drafting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}AI 草拟时间段
                </button>
              )}
            </div>
            <textarea value={mergePrompt} onChange={e => { setMergePrompt(e.target.value); invalidate() }}
              placeholder={mode === 'concat' ? '成片备注/字幕（仅作元数据）' : '整体创意/风格概述（如：把各段衔接为连贯的果茶广告）'}
              rows={3} className="w-full bg-[#0d0d15] border border-white/8 rounded-lg px-3 py-2 text-[12px] text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-indigo-500/40" />
            {mode === 'seedance' && (
              <div className="space-y-1.5">
                {beats.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={b.time} onChange={e => { setBeats(prev => prev.map((x, j) => j === i ? { ...x, time: e.target.value } : x)); invalidate() }}
                      placeholder="0-4s" className="w-20 bg-[#0d0d15] border border-white/8 rounded px-2 py-1 text-[11px] text-gray-200" />
                    <input value={b.action} onChange={e => { setBeats(prev => prev.map((x, j) => j === i ? { ...x, action: e.target.value } : x)); invalidate() }}
                      placeholder="该时间段运镜 + 主体动作" className="flex-1 bg-[#0d0d15] border border-white/8 rounded px-2 py-1 text-[11px] text-gray-200" />
                    <button onClick={() => { setBeats(prev => prev.filter((_, j) => j !== i)); invalidate() }} className="text-gray-600 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <button onClick={() => { setBeats(prev => [...prev, { time: '', action: '' }]); invalidate() }}
                  className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300"><Plus className="w-3 h-3" />添加时间段</button>
              </div>
            )}
            <pre className="w-full max-h-40 bg-[#0d0d15] border border-white/8 rounded-lg px-3 py-2 text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap font-mono overflow-y-auto">
              {promptPreview || '（提示词预览）'}
            </pre>
          </div>

          {/* 查询请求体 + 合并 */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button onClick={togglePayload}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] bg-white/[0.04] text-gray-400 hover:text-gray-200 border border-white/8">
              <FileJson className="w-3.5 h-3.5" />{showPayload ? '隐藏请求体' : '查询请求体'}
            </button>
            <button onClick={submit} disabled={merging || rendering || !allSelectedReady || overCap}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-40">
              {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}{merging ? '合并中…' : '合并成片'}
            </button>
          </div>
          {!allSelectedReady && selectedShots.length > 0 && (
            <p className="text-[10px] text-gray-600">所选分镜尚未全部生成完成，先「全部生成」再合并。</p>
          )}
          {mergeError && <p className="text-[11px] text-red-400">{mergeError}</p>}
          {showPayload && (
            <>
              <p className="text-[10px] text-gray-600">{mode === 'concat' ? '提交给 /compose-final（ffmpeg 拼接）的请求体；clips 为按序解析的分镜视频。' : '提交给 Seedance 2.0 的请求体；参考视频为真实可访问 proxy URL（/api/v1/drama/ref-asset）。'}</p>
              {payloadError && <p className="text-[11px] text-red-400">{payloadError}</p>}
              <pre className="w-full min-h-[16rem] bg-[#14141c] border border-white/8 rounded-xl px-4 py-3 text-[12px] text-gray-200 leading-relaxed whitespace-pre-wrap font-mono overflow-y-auto">
                {payloadLoading ? '加载中…（正在生成真实可访问 URL）' : realPayload ? JSON.stringify(realPayload, null, 2) : ''}
              </pre>
            </>
          )}
          </>
          )}
        </div>
      )}
    </div>
  )
}

/* ── 生成 / 成片视图 ── */
function RenderView({ ep, rendering, renderError, onBackToStoryboard, onGenerateShots, aspect, projectId, onMergeComplete }: {
  ep: DramaEpisode; rendering: boolean; renderError: string
  onBackToStoryboard: () => void; onGenerateShots: (shotIds?: string[]) => void; epReady: boolean
  aspect: string; projectId: string; onMergeComplete: (compositeUrl: string) => void
}) {
  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-gray-600">先生成各分镜视频，再合并成片（单分镜自动作为成片）；生成/合并中请勿离开。</p>
        <button onClick={onBackToStoryboard} disabled={rendering} className="px-3 py-1.5 rounded-lg text-xs bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed">返回分镜</button>
      </div>

      {renderError && <p className="text-[11px] text-red-400">{renderError}</p>}

      {/* 合并成片：① 合并分镜里生成各分镜视频 → ② 合并（A=ffmpeg拼接 / B=Seedance生成） */}
      <MergeFinalPanel ep={ep} aspect={aspect} projectId={projectId}
        rendering={rendering} onGenerateShots={onGenerateShots} onMergeComplete={onMergeComplete} />

      {/* 成片 */}
      {ep.composite_url && (
        <div className="rounded-2xl border border-green-500/20 bg-[#0d0d15] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-green-400 flex items-center gap-1.5"><Scissors className="w-3.5 h-3.5" />本集成片</span>
            <a href={googleService.getResultUrl(ep.composite_url)} download
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200"><Download className="w-3.5 h-3.5" />下载</a>
          </div>
          <video src={googleService.getResultUrl(ep.composite_url)} controls className="w-full max-h-[420px] rounded-lg bg-black" />
        </div>
      )}
    </div>
  )
}

/* ── 合并成剧视图 ──
 * 逐集列举每集成片，可勾选/排序，选转场方式后聚合为整剧成片（体现 OmniWeaver 连贯聚合）。 */
const TRANSITIONS: { key: 'none' | 'crossfade' | 'fade'; label: string; hint: string }[] = [
  { key: 'none', label: '直接拼接', hint: '无转场，逐集首尾相接' },
  { key: 'crossfade', label: '交叉淡化', hint: '相邻两集画面/音频交叉淡入淡出' },
  { key: 'fade', label: '黑场过渡', hint: '经黑场淡出再淡入，段落感更强' },
]

/** 从本集成片 URL（/api/v1/google/task/{id}/file）反解出承载成片的 GenerationTask id。 */
function compositeTaskId(url?: string): string | null {
  if (!url) return null
  const m = /\/task\/([^/]+)\/file/.exec(url)
  return m ? m[1] : null
}

function SeriesComposePanel({ episodes, aspect, projectId, projectName }: {
  episodes: DramaEpisode[]; aspect: string; projectId: string; projectName: string
}) {
  // 仅已出成片的集可参与合并
  const ready = episodes.filter(ep => compositeTaskId(ep.composite_url))
  const [order, setOrder] = useState<number[]>(ready.map(ep => ep.episode))
  const [selected, setSelected] = useState<Set<number>>(new Set(ready.map(ep => ep.episode)))
  const [transition, setTransition] = useState<'none' | 'crossfade' | 'fade'>('crossfade')
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState('')
  const [resultUrl, setResultUrl] = useState('')

  const byEp = new Map(episodes.map(ep => [ep.episode, ep]))
  // 保持 order/selected 与当前可用集同步（增删集或新出成片后不残留/漏项）
  const readyKey = episodes.map(e => `${e.episode}:${e.composite_url || ''}`).join('|')
  const firstSync = useRef(true)
  useEffect(() => {
    const readyEps = episodes.filter(ep => compositeTaskId(ep.composite_url)).map(ep => ep.episode)
    setOrder(prev => {
      const kept = prev.filter(n => readyEps.includes(n))
      const added = readyEps.filter(n => !kept.includes(n))
      return [...kept, ...added]
    })
    setSelected(prev => {
      // 首次：全选；之后：保留已选交集 + 自动纳入新出成片的集
      if (firstSync.current) { firstSync.current = false; return new Set(readyEps) }
      const next = new Set<number>()
      readyEps.forEach(n => { if (prev.has(n)) next.add(n) })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey])

  const selectedOrdered = order.filter(n => selected.has(n))
  const canMerge = selectedOrdered.length >= 1 && !merging

  const toggle = (n: number) => setSelected(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s })
  const move = (idx: number, dir: -1 | 1) => setOrder(prev => {
    const n = [...prev]; const j = idx + dir
    if (j < 0 || j >= n.length) return prev
    ;[n[idx], n[j]] = [n[j], n[idx]]; return n
  })

  const submit = async () => {
    const taskIds = selectedOrdered
      .map(n => compositeTaskId(byEp.get(n)?.composite_url))
      .filter((x): x is string => !!x)
    if (taskIds.length === 0) { setError('请至少选择一集已出成片'); setTimeout(() => setError(''), 4000); return }
    setMerging(true); setError(''); setResultUrl('')
    try {
      const { task_id } = await dramaService.composeSeries({
        drama_project_id: projectId, title: projectName, aspect_ratio: aspect,
        episode_task_ids: taskIds, transition, transition_duration: 0.5,
      })
      const task = await googleService.pollTaskStatus(task_id)
      if (task.status === 'completed') setResultUrl(`/api/v1/google/task/${task_id}/file`)
      else setError(task.error || '合并成剧失败')
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '合并成剧失败')
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 min-h-0">
        <div className="w-full min-w-[320px] max-w-4xl mx-auto space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-100 flex items-center gap-2"><Layers className="w-4 h-4 text-indigo-400" />合并成剧</h2>
            <p className="text-[11px] text-gray-600 mt-1">勾选并排序各集成片，选择转场方式后聚合为一部连贯的整剧。仅列出已出成片的集。</p>
          </div>

          {ready.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Layers className="w-12 h-12 text-gray-800 mb-3" />
              <p className="text-gray-500 text-sm mb-1">还没有可合并的每集成片</p>
              <p className="text-gray-700 text-xs">请先到「多集创作」为各集生成成片，再回到这里合并成剧。</p>
            </div>
          ) : (
            <>
              {/* 逐集列举 */}
              <div className="space-y-2">
                {order.map((n, idx) => {
                  const ep = byEp.get(n)
                  if (!ep) return null
                  const label = (ep.title || '').trim() || `第${ep.episode}集`
                  const url = googleService.getResultUrl(ep.composite_url)
                  const sel = selected.has(n)
                  return (
                    <div key={n} className={`rounded-xl border p-3 flex gap-3 ${sel ? 'border-indigo-500/30 bg-indigo-500/[0.05]' : 'border-white/8 bg-[#0d0d15]'}`}>
                      <input type="checkbox" checked={sel} onChange={() => toggle(n)} className="mt-1 accent-indigo-500 flex-shrink-0" />
                      <div className="flex-shrink-0 w-40">
                        <video src={url} controls className="w-full rounded-md bg-black max-h-28" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <span className="text-xs font-medium text-gray-200 truncate">{label}</span>
                        <span className="text-[10px] text-gray-600 mt-0.5">第 {ep.episode} 集 · {ep.shots.length} 镜</span>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1">
                        <button onClick={() => move(idx, -1)} disabled={idx === 0} className="px-1.5 py-0.5 rounded text-[11px] bg-white/[0.04] text-gray-400 disabled:opacity-30">↑</button>
                        <button onClick={() => move(idx, 1)} disabled={idx === order.length - 1} className="px-1.5 py-0.5 rounded text-[11px] bg-white/[0.04] text-gray-400 disabled:opacity-30">↓</button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* 转场方式 */}
              <div className="rounded-xl border border-white/8 bg-[#0d0d15] p-3 space-y-2">
                <span className="text-[11px] font-semibold text-gray-300">镜头转场（连贯聚合）</span>
                <div className="flex flex-wrap gap-2">
                  {TRANSITIONS.map(t => (
                    <button key={t.key} onClick={() => setTransition(t.key)} title={t.hint}
                      className={`px-3 py-1.5 rounded-lg text-[11px] border ${transition === t.key ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' : 'bg-white/[0.03] text-gray-400 border-white/8 hover:text-gray-200'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-600">{TRANSITIONS.find(t => t.key === transition)?.hint}</p>
              </div>

              {/* 合并动作 */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] text-gray-600">已选 {selectedOrdered.length}/{ready.length} 集</span>
                <button onClick={submit} disabled={!canMerge}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-40">
                  {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}{merging ? '合并成剧中…' : '合并成剧'}
                </button>
              </div>
              {error && <p className="text-[11px] text-red-400">{error}</p>}

              {/* 整剧成片 */}
              {resultUrl && (
                <div className="rounded-2xl border border-green-500/20 bg-[#0d0d15] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-green-400 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" />整剧成片</span>
                    <a href={googleService.getResultUrl(resultUrl)} download
                      className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200"><Download className="w-3.5 h-3.5" />下载</a>
                  </div>
                  <video src={googleService.getResultUrl(resultUrl)} controls className="w-full max-h-[420px] rounded-lg bg-black" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
