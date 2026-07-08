import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { studioService, StudioFeature, StudioHistoryItem } from '../services/studio.service'
import { getQuickPrompts, polishPrompt, QuickPrompt } from '../services/prompt.service'
import { useCreditStore } from '../store/credit.store'
import {
  Upload, Loader2, Wand2, Film, Clapperboard, PersonStanding, Scissors,
  Send, X, Download, Play, Sparkles, ChevronLeft, ChevronRight, CheckCircle, Video,
} from 'lucide-react'

export type VideoStudioMode = 'short_video' | 'video2video' | 'motion' | 'video_edit'

interface ModeConfig {
  feature: StudioFeature
  title: string
  subtitle: string
  icon: any
  needsPrompt: boolean
  promptPlaceholder: string
  imageInput?: { key: 'first_frame' | 'character'; label: string; optional?: boolean }
  videoInput?: { label: string }
  editTypes?: { value: string; label: string }[]
  cost: number
}

const MODE_CONFIG: Record<VideoStudioMode, ModeConfig> = {
  short_video: {
    feature: 'short_video', title: 'AI短视频', subtitle: '文案 / 图片一键生成短视频',
    icon: Film, needsPrompt: true, cost: 120,
    promptPlaceholder: '描述你想要的短视频画面、镜头与氛围…',
    imageInput: { key: 'first_frame', label: '首帧图(可选)', optional: true },
  },
  video2video: {
    feature: 'video2video', title: '视频生成视频', subtitle: '上传视频 + 提示词,风格化转绘',
    icon: Clapperboard, needsPrompt: true, cost: 150,
    promptPlaceholder: '描述想要的风格 / 画面变化,例如:转为吉卜力动画风、赛博朋克霓虹夜景…',
    videoInput: { label: '源视频' },
  },
  motion: {
    feature: 'motion', title: '动作模仿', subtitle: '角色图 + 动作参考视频,迁移动作',
    icon: PersonStanding, needsPrompt: false, cost: 150,
    promptPlaceholder: '可选:补充动作或画面描述…',
    imageInput: { key: 'character', label: '角色图' },
    videoInput: { label: '动作参考视频' },
  },
  video_edit: {
    feature: 'video_edit', title: '视频编辑', subtitle: '换背景 / 风格 / 人物等智能编辑',
    icon: Scissors, needsPrompt: true, cost: 80,
    promptPlaceholder: '描述编辑指令,例如:把背景换成雪山、让画面变成黄昏暖色调…',
    videoInput: { label: '源视频' },
    editTypes: [
      { value: 'basic', label: '基础编辑(背景/天气)' },
      { value: 'style', label: '风格转换(动漫/电影)' },
      { value: 'character', label: '人物变换(变年轻/换装)' },
    ],
  },
}

/**
 * 动作模仿「动作参考视频」内置范例。复用历史版本已自托管、验证可用的样例动画
 * (同域 /api/v1/static),点击后抓取为 File 走正常上传流程,得到可供网关处理的 motion_video_id。
 */
const MOTION_SAMPLES = [
  { id: 'm1', label: '电影级光影', url: '/api/v1/static/464663a48de8.mp4' },
  { id: 'm2', label: '动态特写', url: '/api/v1/static/f136a18fe198.mp4' },
  { id: 'm3', label: '动漫奇幻', url: '/api/v1/static/afaa68a13daa.mp4' },
  { id: 'm4', label: '创意影像', url: '/api/v1/static/368fadafcc01.mp4' },
  { id: 'm5', label: '震撼特效', url: '/api/v1/static/9579ee6616e8.mp4' },
  { id: 'm6', label: '写实场景', url: '/api/v1/static/c7d764e94f29.mp4' },
]

const CARD_GRADIENTS = [
  'from-pink-900/80 to-purple-900/80',
  'from-blue-900/80 to-cyan-900/80',
  'from-orange-900/80 to-red-900/80',
  'from-green-900/80 to-teal-900/80',
  'from-indigo-900/80 to-purple-900/80',
  'from-yellow-900/80 to-orange-900/80',
]

export default function VideoStudio({ mode }: { mode: VideoStudioMode }) {
  const cfg = MODE_CONFIG[mode]
  useDocumentTitle(cfg.title)
  const navigate = useNavigate()
  const { balance, fetchBalance } = useCreditStore()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [editType, setEditType] = useState(cfg.editTypes?.[0].value || 'basic')
  const [imageId, setImageId] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [videoId, setVideoId] = useState<string | null>(null)
  const [videoPreview, setVideoPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [samplingId, setSamplingId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<StudioHistoryItem[]>([])

  // prompt helpers
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>([])
  const [isPolishing, setIsPolishing] = useState(false)

  // carousel + preview modal
  const [currentSlide, setCurrentSlide] = useState(0)
  const [previewVideo, setPreviewVideo] = useState<string | null>(null)

  // 切换功能时重置
  useEffect(() => {
    setPrompt(''); setImageId(null); setImagePreview(null); setVideoId(null)
    setVideoPreview(null); setResultUrl(null); setError(null); setProgress(0)
    setEditType(cfg.editTypes?.[0].value || 'basic'); setCurrentSlide(0)
  }, [mode])

  useEffect(() => { fetchBalance() }, [fetchBalance])

  useEffect(() => {
    studioService.getHistory(cfg.feature, 12).then(setHistory).catch(() => {})
  }, [mode, running])

  // 视频类提示词建议
  useEffect(() => {
    if (!cfg.needsPrompt) return
    let cancelled = false
    getQuickPrompts('video').then((p) => { if (!cancelled) setQuickPrompts(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [mode])

  useEffect(() => { setCurrentSlide(0) }, [history.length])

  const handleUpload = async (file: File, kind: 'image' | 'video') => {
    setUploading(true); setError(null)
    try {
      const res = await studioService.upload(file)
      const preview = URL.createObjectURL(file)
      if (kind === 'video') { setVideoId(res.file_id); setVideoPreview(preview) }
      else { setImageId(res.file_id); setImagePreview(preview) }
    } catch (e: any) {
      setError(e?.response?.data?.detail || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  // 选用内置范例动作参考视频:抓取为 File 后复用上传流程
  const handlePickSample = async (sample: { id: string; label: string; url: string }) => {
    if (uploading || running || samplingId) return
    setSamplingId(sample.id); setError(null)
    try {
      const resp = await fetch(sample.url)
      if (!resp.ok) throw new Error('范例加载失败')
      const blob = await resp.blob()
      const file = new File([blob], `${sample.id}.mp4`, { type: blob.type || 'video/mp4' })
      await handleUpload(file, 'video')
    } catch (e: any) {
      setError(e?.message || '范例加载失败')
    } finally {
      setSamplingId(null)
    }
  }

  const handlePolish = async () => {
    if (!prompt.trim() || isPolishing) return
    setIsPolishing(true)
    try {
      const polished = await polishPrompt(prompt.trim(), 'video')
      setPrompt(polished)
    } catch {
      // 失败时保留原始提示词
    } finally {
      setIsPolishing(false)
    }
  }

  const canRun = (() => {
    if (cfg.needsPrompt && !prompt.trim()) return false
    if (cfg.imageInput && !cfg.imageInput.optional && !imageId) return false
    if (cfg.videoInput && !videoId) return false
    return !uploading && !running
  })()

  const handleRun = async () => {
    if (balance < cfg.cost) { setError(`积分不足!需要 ${cfg.cost},当前余额 ${Math.round(balance)}`); return }
    setRunning(true); setError(null); setResultUrl(null); setProgress(0)
    try {
      let task
      if (mode === 'short_video') {
        task = await studioService.createShortVideo({ prompt, first_frame_id: imageId || undefined })
      } else if (mode === 'video2video') {
        task = await studioService.createVideo2Video({ prompt, video_id: videoId! })
      } else if (mode === 'motion') {
        task = await studioService.createMotion({ prompt: prompt || undefined, character_image_id: imageId!, motion_video_id: videoId! })
      } else {
        task = await studioService.createVideoEdit({ prompt, video_id: videoId!, edit_type: editType })
      }
      const final = await studioService.pollTask(task.task_id, (p) => setProgress(p))
      if (final.status === 'completed' && final.result_url) {
        setResultUrl(studioService.getResultUrl(final.result_url))
        fetchBalance()
      } else {
        setError(final.error || '生成失败')
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '生成失败')
    } finally {
      setRunning(false)
    }
  }

  const Icon = cfg.icon
  const slideCount = history.length
  const nextSlide = () => setCurrentSlide((p) => (p + 1) % Math.max(slideCount, 1))
  const prevSlide = () => setCurrentSlide((p) => (p - 1 + slideCount) % Math.max(slideCount, 1))

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 flex flex-col bg-[#0d0d0f] min-w-0 overflow-y-auto px-4 md:px-8 py-4 md:py-6">
          {/* 标题 */}
          <div className="flex items-center gap-2 mb-1">
            <Icon className="w-6 h-6 text-pink-400" />
            <h1 className="text-xl md:text-2xl font-bold text-gray-100">{cfg.title}</h1>
          </div>
          <p className="text-sm text-gray-500 mb-5">{cfg.subtitle}</p>

          {/* 输入卡片 */}
          <div className="bg-[#16161a] rounded-2xl border border-gray-800/50 p-4 md:p-5 mb-4">
            <div className="grid md:grid-cols-[auto_1fr] gap-4">
              {/* 上传区 */}
              {(cfg.imageInput || cfg.videoInput) && (
                <div className="flex md:flex-col gap-3">
                  {cfg.imageInput && (
                    <UploadBox label={cfg.imageInput.label} preview={imagePreview} accept="image/*"
                               onFile={(f) => handleUpload(f, 'image')}
                               onClear={() => { setImageId(null); setImagePreview(null) }} />
                  )}
                  {cfg.videoInput && (
                    <UploadBox label={cfg.videoInput.label} preview={videoPreview} isVideo accept="video/*"
                               onFile={(f) => handleUpload(f, 'video')}
                               onClear={() => { setVideoId(null); setVideoPreview(null) }} />
                  )}
                </div>
              )}

              {/* 提示词区 */}
              <div className="flex flex-col">
                <textarea
                  value={prompt} onChange={(e) => setPrompt(e.target.value)}
                  placeholder={cfg.promptPlaceholder}
                  disabled={running}
                  className="flex-1 min-h-[120px] w-full bg-transparent border-none text-gray-100 placeholder:text-gray-500 resize-none focus:outline-none text-base leading-relaxed"
                />
                {cfg.editTypes && (
                  <select value={editType} onChange={(e) => setEditType(e.target.value)} disabled={running}
                          className="mt-2 self-start bg-[#0d0d0f] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200">
                    {cfg.editTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* 动作模仿:内置动作参考范例 */}
            {mode === 'motion' && (
              <div className="mt-4">
                <p className="text-xs text-gray-500 mb-2">示例动作参考(点击直接使用,亦可上传自己的视频):</p>
                <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
                  {MOTION_SAMPLES.map((s) => (
                    <button key={s.id} onClick={() => handlePickSample(s)}
                            disabled={!!samplingId || uploading || running}
                            title={`使用范例:${s.label}`}
                            className="group relative w-28 h-20 flex-shrink-0 rounded-lg overflow-hidden border border-gray-800 hover:border-pink-500/50 transition-colors disabled:opacity-50">
                      <video src={s.url} className="absolute inset-0 w-full h-full object-cover" muted loop playsInline preload="metadata"
                             onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                             onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                      {samplingId === s.id ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="w-5 h-5 text-white" fill="white" />
                        </div>
                      )}
                      <span className="absolute bottom-1 left-1.5 right-1.5 text-[10px] text-gray-200 truncate">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 底栏: 积分 + 润色 + 生成 */}
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-800/50">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-500">消耗 <span className="text-pink-400 font-medium">{cfg.cost}</span> 积分</span>
                <span className="text-gray-600">|</span>
                <span className="text-gray-500">余额 <span className="text-gray-300 font-medium">{Math.round(balance)}</span></span>
              </div>
              <div className="flex items-center gap-2">
                {cfg.needsPrompt && (
                  <button
                    onClick={handlePolish}
                    disabled={!prompt.trim() || isPolishing || running}
                    title={prompt.trim() ? 'AI一键润色' : '请先输入描述'}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                      !prompt.trim() || isPolishing || running
                        ? 'border-gray-700 text-gray-600 cursor-not-allowed'
                        : 'border-purple-500/50 text-purple-300 hover:bg-purple-500/10 hover:border-purple-400'
                    }`}
                  >
                    {isPolishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    <span>{isPolishing ? '润色中…' : '一键润色'}</span>
                  </button>
                )}
                <button
                  disabled={!canRun} onClick={handleRun}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium transition-all ${
                    !canRun
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:shadow-lg hover:shadow-pink-500/30 hover:scale-[1.02]'
                  }`}
                >
                  {running ? <><Loader2 className="w-5 h-5 animate-spin" /> 生成中 {progress}%</>
                    : <><Send className="w-5 h-5" /> 开始生成</>}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

            {/* 快速提示 */}
            {cfg.needsPrompt && quickPrompts.length > 0 && (
              <div className="flex items-center gap-2 mt-4 overflow-x-auto pb-1 scrollbar-hide">
                <span className="text-xs text-gray-500 mr-1 flex-shrink-0">快速提示:</span>
                {quickPrompts.map((item, i) => (
                  <button key={`${item.label}-${i}`} onClick={() => setPrompt(item.prompt)}
                          className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 transition-all">
                    <span>{item.icon}</span> {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 当前生成结果 */}
          {(running || resultUrl) && (
            <div className="bg-[#16161a] rounded-2xl border border-gray-800/50 p-4 md:p-5 mb-4">
              <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
                {resultUrl ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Loader2 className="w-4 h-4 animate-spin text-pink-400" />}
                {resultUrl ? '生成完成' : `生成中 ${progress}%`}
              </h3>
              {resultUrl ? (
                <div className="space-y-3">
                  <video src={resultUrl} controls className="w-full max-w-2xl rounded-xl border border-gray-800/50 bg-black" />
                  <a href={resultUrl} download className="inline-flex items-center gap-1.5 text-sm text-pink-400 hover:text-pink-300">
                    <Download className="w-4 h-4" /> 下载视频
                  </a>
                </div>
              ) : (
                <div className="w-full bg-gray-800 rounded-full h-2 max-w-2xl">
                  <div className="bg-gradient-to-r from-pink-500 to-purple-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          )}

          {/* 作品展示轮播 */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-pink-400" strokeWidth={1.5} />
              {slideCount > 0 ? '我的作品' : '作品展示'}
            </h3>
            {slideCount > 0 && (
              <button onClick={() => navigate('/gallery')} className="text-xs text-pink-400 hover:text-pink-300">
                查看全部 ({slideCount})
              </button>
            )}
          </div>

          {slideCount === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[200px] text-gray-500 bg-[#16161a]/50 rounded-2xl border border-gray-800/30">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500/10 to-purple-500/10 flex items-center justify-center mb-3 border border-pink-500/20">
                <Video className="w-8 h-8 text-pink-500/50" strokeWidth={1} />
              </div>
              <p className="text-base font-medium text-gray-300">还没有作品</p>
              <p className="text-xs mt-1.5 text-gray-500">在上方开始你的第一次创作</p>
            </div>
          ) : (
            <div className="relative min-h-[220px] md:min-h-[340px]">
              {/* 移动端:单卡轮播 */}
              <div className="md:hidden relative h-[220px] overflow-hidden rounded-2xl">
                {history.map((item, index) => (
                  <CarouselCard key={item.task_id} item={item} index={index} active={index === currentSlide}
                                position={index < currentSlide ? 'left' : index > currentSlide ? 'right' : 'center'}
                                onOpen={() => setPreviewVideo(studioService.getResultUrl(item.result_url))} />
                ))}
              </div>

              {/* 桌面端:多卡轮播 */}
              <div className="hidden md:flex gap-4 h-[340px]">
                {history.map((item, index) => {
                  const isActive = index === currentSlide
                  const isPrev = index === (currentSlide - 1 + slideCount) % slideCount
                  const isNext = index === (currentSlide + 1) % slideCount
                  return (
                    <div key={item.task_id}
                         className={`relative rounded-2xl cursor-pointer transition-all duration-300 ${
                           isActive ? 'flex-[2] opacity-100' : isPrev || isNext ? 'flex-1 opacity-60 hover:opacity-90' : 'flex-0 w-0 opacity-0 overflow-hidden'
                         }`}
                         onClick={() => { if (index !== currentSlide) setCurrentSlide(index); else setPreviewVideo(studioService.getResultUrl(item.result_url)) }}>
                      <CardInner item={item} index={index} showPlay={isActive} />
                    </div>
                  )
                })}
              </div>

              {/* 箭头 */}
              {slideCount > 1 && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); prevSlide() }}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 md:w-10 md:h-10 bg-black/60 hover:bg-pink-500/80 rounded-full flex items-center justify-center text-white z-10 border border-white/10">
                    <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); nextSlide() }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 md:w-10 md:h-10 bg-black/60 hover:bg-pink-500/80 rounded-full flex items-center justify-center text-white z-10 border border-white/10">
                    <ChevronRight className="w-5 h-5 md:w-6 md:h-6" />
                  </button>
                </>
              )}

              {/* 圆点 */}
              {slideCount > 1 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/40 backdrop-blur-sm px-3 py-2 rounded-full z-10">
                  {history.map((_, index) => (
                    <button key={index} onClick={() => setCurrentSlide(index)}
                            className={`h-2 rounded-full transition-all ${index === currentSlide ? 'bg-gradient-to-r from-pink-500 to-purple-500 w-6' : 'bg-white/40 hover:bg-white/60 w-2'}`} />
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* 视频预览弹窗 */}
      {previewVideo && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setPreviewVideo(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <button className="absolute -top-10 right-0 text-gray-300 hover:text-white" onClick={() => setPreviewVideo(null)}>
              <X className="w-8 h-8" />
            </button>
            <video src={previewVideo} controls autoPlay loop playsInline
                   className="max-w-full max-h-[85vh] object-contain rounded-lg border border-gray-800/50 bg-black"
                   onClick={(e) => e.stopPropagation()} />
            <a href={previewVideo} download onClick={(e) => e.stopPropagation()}
               className="absolute bottom-4 right-4 bg-[#1a1a1f] hover:bg-[#252530] text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 border border-gray-700/50">
              <Download className="w-4 h-4" /> 下载
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function CarouselCard({ item, index, active, position, onOpen }: {
  item: StudioHistoryItem; index: number; active: boolean; position: 'left' | 'center' | 'right'; onOpen: () => void
}) {
  return (
    <div className={`absolute inset-0 transition-all duration-300 ease-out ${
      active ? 'opacity-100 translate-x-0' : position === 'left' ? 'opacity-0 -translate-x-full' : 'opacity-0 translate-x-full'
    }`} onClick={onOpen}>
      <CardInner item={item} index={index} showPlay />
    </div>
  )
}

function CardInner({ item, index, showPlay }: { item: StudioHistoryItem; index: number; showPlay: boolean }) {
  const url = studioService.getResultUrl(item.result_url)
  return (
    <div className="absolute inset-0 rounded-2xl overflow-hidden group border border-gray-800/50 hover:border-pink-500/30 transition-colors">
      {url ? (
        <video src={url} className="absolute inset-0 w-full h-full object-cover" muted loop playsInline preload="metadata"
               onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
               onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }} />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${CARD_GRADIENTS[index % CARD_GRADIENTS.length]}`} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      {showPlay && (
        <div className="absolute top-4 right-4 bg-pink-500/80 backdrop-blur-sm rounded-full p-2.5 pointer-events-none z-10">
          <Play className="w-5 h-5 text-white" fill="white" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-5 z-10">
        <h3 className="text-base md:text-lg font-bold text-white mb-1 line-clamp-2">{item.prompt || '创作作品'}</h3>
        <p className="text-xs text-gray-300/80 line-clamp-1">{item.model_id || '精选展示'}</p>
      </div>
    </div>
  )
}

function UploadBox({ label, preview, onFile, onClear, accept, isVideo }: {
  label: string; preview: string | null; onFile: (f: File) => void; onClear: () => void; accept: string; isVideo?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="relative w-32 md:w-44 h-32 md:h-40 rounded-xl border border-dashed border-gray-700 bg-[#0d0d0f] overflow-hidden flex-shrink-0">
      {preview ? (
        <>
          {isVideo
            ? <video src={preview} className="absolute inset-0 w-full h-full object-cover" muted />
            : <img src={preview} alt={label} className="absolute inset-0 w-full h-full object-cover" />}
          <button onClick={onClear}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center text-white z-10">
            <X className="w-3.5 h-3.5" />
          </button>
          <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[11px] text-gray-200 px-2 py-1 truncate">{label}</span>
        </>
      ) : (
        <button onClick={() => inputRef.current?.click()}
                className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-500 hover:text-gray-300 hover:border-pink-500/30 transition-colors">
          <Upload className="w-6 h-6" />
          <span className="text-xs px-2 text-center">{label}</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept={accept} className="hidden"
             onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  )
}
