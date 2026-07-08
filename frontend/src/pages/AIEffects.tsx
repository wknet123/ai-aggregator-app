import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { effectCategories, effects, getEffectsByCategory, Effect } from '../data/effectsData'
import { studioService, StudioHistoryItem } from '../services/studio.service'
import { useCreditStore } from '../store/credit.store'
import {
  Sparkles, Upload, Loader2, X, Wand2, Download, Play,
  Image as ImageIcon, Video as VideoIcon, ChevronLeft, ChevronRight, CheckCircle,
} from 'lucide-react'

/** 精选范例:有真实风格示例图的特效,置顶展示并可一键选用 */
const FEATURED = effects.filter((e) => e.sampleImage)

export default function AIEffects() {
  useDocumentTitle('AI特效')
  const navigate = useNavigate()
  const { balance, fetchBalance } = useCreditStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeCat, setActiveCat] = useState(effectCategories[0].id)
  const [selected, setSelected] = useState<Effect | null>(FEATURED[0] || effects[0])
  const [imageId, setImageId] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [refId, setRefId] = useState<string | null>(null)
  const [refPreview, setRefPreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<StudioHistoryItem[]>([])
  const [currentSlide, setCurrentSlide] = useState(0)

  useEffect(() => {
    studioService.getHistory('effect', 12).then(setHistory).catch(() => {})
  }, [running])

  useEffect(() => { fetchBalance() }, [fetchBalance])
  useEffect(() => { setCurrentSlide(0) }, [history.length])

  // 选择特效时清空上一次的输入与结果(保留所选特效)
  const pickEffect = (e: Effect) => {
    setSelected(e); setImageId(null); setImagePreview(null)
    setRefId(null); setRefPreview(null); setPrompt(''); setResultUrl(null); setError(null); setProgress(0)
  }

  const handleUpload = async (file: File, isRef: boolean) => {
    setUploading(true); setError(null)
    try {
      const res = await studioService.upload(file)
      const preview = URL.createObjectURL(file)
      if (isRef) { setRefId(res.file_id); setRefPreview(preview) }
      else { setImageId(res.file_id); setImagePreview(preview) }
    } catch (e: any) {
      setError(e?.response?.data?.detail || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleRun = async () => {
    if (!selected || !imageId) return
    if (balance < selected.credits) { setError(`积分不足!需要 ${selected.credits},当前余额 ${Math.round(balance)}`); return }
    setRunning(true); setError(null); setResultUrl(null); setProgress(0)
    try {
      const task = await studioService.createEffect({
        effect_id: selected.id,
        image_id: imageId,
        reference_image_id: refId || undefined,
        prompt: prompt || undefined,
      })
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

  const catEffects = getEffectsByCategory(activeCat)
  const slideCount = history.length
  const nextSlide = () => setCurrentSlide((p) => (p + 1) % Math.max(slideCount, 1))
  const prevSlide = () => setCurrentSlide((p) => (p - 1 + slideCount) % Math.max(slideCount, 1))

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 flex flex-col bg-[#0d0d0f] min-w-0 overflow-y-auto p-4 md:p-8">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-6 h-6 text-orange-400" />
            <h1 className="text-xl md:text-2xl font-bold text-gray-100">AI特效</h1>
          </div>
          <p className="text-sm text-gray-500 mb-5">选择特效 · 上传图片 · 一键生成,全部在本页完成</p>

          {/* 精选范例 */}
          {FEATURED.length > 0 && (
            <div className="mb-6">
              <p className="text-sm text-gray-300 font-medium mb-2 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-orange-400" /> 精选范例
              </p>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {FEATURED.map((e) => (
                  <button key={e.id} onClick={() => pickEffect(e)}
                          className={`group relative w-36 h-24 flex-shrink-0 rounded-xl overflow-hidden border transition-all ${
                            selected?.id === e.id ? 'border-orange-500 ring-1 ring-orange-500/40' : 'border-gray-800 hover:border-orange-500/50'
                          }`}>
                    <img src={e.sampleImage} alt={e.name} className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-2">
                      <p className="text-xs font-semibold text-white truncate">{e.name}</p>
                      <p className="text-[10px] text-orange-300/90">{e.credits} 积分</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 主体:左侧特效库 + 右侧操作面板,单页完成 */}
          <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
            {/* 左:分类 + 特效网格 */}
            <div>
              <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-2 scrollbar-hide">
                {effectCategories.map((c) => (
                  <button key={c.id} onClick={() => setActiveCat(c.id)}
                          className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                            activeCat === c.id ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                              : 'bg-[#16161a] text-gray-400 border border-gray-800/50 hover:text-gray-200'
                          }`}>
                    {c.name}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {catEffects.map((e) => {
                  const isSel = selected?.id === e.id
                  return (
                    <button key={e.id} onClick={() => pickEffect(e)}
                            className={`text-left rounded-xl overflow-hidden border transition-all ${
                              isSel ? 'border-orange-500 ring-1 ring-orange-500/40 bg-[#1a1a1f]' : 'border-gray-800/50 bg-[#16161a] hover:border-orange-500/40'
                            }`}>
                      <div className="relative h-20 bg-gradient-to-br from-orange-500/10 to-pink-500/10 flex items-center justify-center">
                        {e.sampleImage ? (
                          <img src={e.sampleImage} alt={e.name} className="absolute inset-0 w-full h-full object-cover" />
                        ) : e.outputType === 'video' ? (
                          <VideoIcon className="w-7 h-7 text-cyan-400/70" />
                        ) : (
                          <ImageIcon className="w-7 h-7 text-orange-400/70" />
                        )}
                        <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-gray-200">
                          {e.outputType === 'video' ? '视频' : '图像'}
                        </span>
                      </div>
                      <div className="p-2.5">
                        <p className="text-sm font-medium text-gray-200">{e.name}</p>
                        <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5 h-8">{e.description}</p>
                        <p className="text-[11px] text-orange-400/80 mt-1">{e.credits} 积分</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 右:操作面板(粘性) */}
            <div className="lg:sticky lg:top-0 bg-[#16161a] rounded-2xl border border-gray-800/50 p-4">
              {selected ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {selected.outputType === 'video'
                        ? <VideoIcon className="w-5 h-5 text-cyan-400" />
                        : <ImageIcon className="w-5 h-5 text-orange-400" />}
                      <h2 className="text-base font-semibold text-gray-100">{selected.name}</h2>
                    </div>
                    <span className="text-xs text-orange-400/90">{selected.credits} 积分</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">{selected.description}</p>

                  {selected.sampleImage && (
                    <div className="mb-3">
                      <p className="text-[11px] text-gray-500 mb-1">效果示例</p>
                      <img src={selected.sampleImage} alt="示例" className="w-full h-28 object-cover rounded-lg border border-gray-800/50" />
                    </div>
                  )}

                  <div className={`grid ${selected.requiresReference ? 'grid-cols-2' : 'grid-cols-1'} gap-3 mb-3`}>
                    <UploadBox label="原图" preview={imagePreview} accept="image/*"
                               onFile={(f) => handleUpload(f, false)} onClear={() => { setImageId(null); setImagePreview(null) }} />
                    {selected.requiresReference && (
                      <UploadBox label="参考图" preview={refPreview} accept="image/*"
                                 onFile={(f) => handleUpload(f, true)} onClear={() => { setRefId(null); setRefPreview(null) }} />
                    )}
                  </div>

                  <textarea
                    value={prompt} onChange={(e) => setPrompt(e.target.value)}
                    placeholder="可选:补充描述(留空使用默认特效提示词)"
                    disabled={running}
                    className="w-full bg-[#0d0d0f] border border-gray-800 rounded-lg p-2.5 text-sm text-gray-200 mb-3 resize-none" rows={2}
                  />

                  {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

                  {(running || resultUrl) && (
                    <div className="mb-3">
                      {resultUrl ? (
                        <div className="space-y-2">
                          {selected.outputType === 'video'
                            ? <video src={resultUrl} controls className="w-full rounded-lg border border-gray-800/50 bg-black" />
                            : <img src={resultUrl} alt="结果" className="w-full rounded-lg border border-gray-800/50" />}
                          <a href={resultUrl} download className="inline-flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300">
                            <Download className="w-4 h-4" /> 下载
                          </a>
                        </div>
                      ) : (
                        <div className="w-full bg-gray-800 rounded-full h-2">
                          <div className="bg-gradient-to-r from-orange-500 to-pink-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                    <span>余额 <span className="text-gray-300">{Math.round(balance)}</span></span>
                    {resultUrl && <span className="flex items-center gap-1 text-green-400"><CheckCircle className="w-3.5 h-3.5" /> 已完成</span>}
                  </div>

                  <button disabled={!imageId || uploading || running} onClick={handleRun}
                          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium transition-all ${
                            !imageId || uploading || running
                              ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                              : 'bg-gradient-to-r from-orange-500 to-pink-500 text-white hover:shadow-lg hover:shadow-orange-500/30'
                          }`}>
                    {running ? <><Loader2 className="w-4 h-4 animate-spin" /> 生成中 {progress}%</>
                      : uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> 上传中</>
                      : <><Wand2 className="w-4 h-4" /> 应用特效 ({selected.credits} 积分)</>}
                  </button>
                  {!imageId && <p className="text-[11px] text-gray-600 text-center mt-2">请先上传原图</p>}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <Sparkles className="w-8 h-8 mb-2 text-gray-600" />
                  <p className="text-sm">从左侧选择一个特效开始</p>
                </div>
              )}
            </div>
          </div>

          {/* 我的作品 轮播 */}
          {slideCount > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-orange-400" strokeWidth={1.5} /> 我的作品
                </h3>
                <button onClick={() => navigate('/gallery')} className="text-xs text-orange-400 hover:text-orange-300">
                  查看全部 ({slideCount})
                </button>
              </div>
              <div className="relative">
                <div className="flex gap-3 overflow-hidden">
                  {history.slice(currentSlide, currentSlide + 6).map((h) => {
                    const url = studioService.getResultUrl(h.result_url)
                    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(h.result_url) || (h.parameters?.output_type === 'video')
                    return (
                      <div key={h.task_id} className="relative w-28 h-28 md:w-36 md:h-36 flex-shrink-0 rounded-xl overflow-hidden border border-gray-800/50 group">
                        {isVideo ? (
                          <video src={url} className="absolute inset-0 w-full h-full object-cover" muted loop playsInline preload="metadata"
                                 onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                                 onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }} />
                        ) : (
                          <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        )}
                        {isVideo && (
                          <div className="absolute top-2 right-2 bg-black/60 rounded-full p-1 pointer-events-none">
                            <Play className="w-3 h-3 text-white" fill="white" />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {slideCount > 6 && (
                  <>
                    <button onClick={prevSlide} className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 hover:bg-orange-500/80 rounded-full flex items-center justify-center text-white border border-white/10">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button onClick={nextSlide} className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 hover:bg-orange-500/80 rounded-full flex items-center justify-center text-white border border-white/10">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function UploadBox({ label, preview, onFile, onClear, accept }: {
  label: string; preview: string | null; onFile: (f: File) => void; onClear: () => void; accept: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="relative h-32 rounded-lg border border-dashed border-gray-700 bg-[#0d0d0f] overflow-hidden">
      {preview ? (
        <>
          <img src={preview} alt={label} className="absolute inset-0 w-full h-full object-cover" />
          <button onClick={onClear} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center text-white z-10">
            <X className="w-3.5 h-3.5" />
          </button>
          <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[11px] text-gray-200 px-2 py-1">{label}</span>
        </>
      ) : (
        <button onClick={() => inputRef.current?.click()}
                className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-500 hover:text-gray-300 transition-colors">
          <Upload className="w-5 h-5" />
          <span className="text-xs">{label}</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept={accept} className="hidden"
             onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  )
}
