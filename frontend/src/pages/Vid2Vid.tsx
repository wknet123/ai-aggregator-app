import { useState, useEffect, useRef } from 'react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { studioService } from '../services/studio.service'
import { useCreditStore } from '../store/credit.store'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  vid2vidStyles,
  vid2vidModels,
  outputCountOptions,
  ratioOptions,
  durationOptions,
  sampleVideos,
  type Vid2VidStyle,
  type Vid2VidModel,
  type OutputCount,
} from '../data/vid2vidStyles'
import {
  Loader2,
  Upload,
  Play,
  Download,
  X,
  Sparkles,
  Coins,
  ChevronDown,
  ChevronUp,
  Search,
  Video,
  Check,
  ImageIcon,
  Plus,
} from 'lucide-react'

// ─── Style Card ───────────────────────────────────────────────────────────────
function StyleCard({
  style,
  selected,
  onSelect,
}: {
  style: Vid2VidStyle
  selected: boolean
  onSelect: () => void
}) {
  const [imgError, setImgError] = useState(false)
  const showImage = !!style.previewImage && !imgError

  return (
    <button
      onClick={onSelect}
      className={`relative rounded-lg overflow-hidden transition-all duration-150 text-left w-full group ${
        selected
          ? 'ring-2 ring-purple-500 shadow-[0_0_0_2px_rgba(139,92,246,0.5)]'
          : 'ring-1 ring-white/8 hover:ring-white/20'
      }`}
    >
      <div className="relative overflow-hidden aspect-[4/3]" style={{ background: style.gradient }}>
        {showImage && (
          <img
            src={style.previewImage}
            alt={style.name}
            loading="lazy"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        <span
          className={`absolute top-1.5 left-1.5 z-10 text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${
            style.version === 'V5' ? 'bg-purple-600/90 text-white' : 'bg-[#4a3f6b]/90 text-purple-200'
          }`}
        >
          {style.version}
        </span>
        {selected && (
          <div className="absolute top-1.5 right-1.5 z-10 w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
            <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
          </div>
        )}
      </div>
      <div className="px-1.5 py-2 bg-[#18181f] text-center">
        <p className="text-[11px] text-gray-300 truncate leading-tight">{style.name}</p>
      </div>
    </button>
  )
}

// ─── Style Select Modal ───────────────────────────────────────────────────────
function StyleModal({
  selected,
  onSelect,
  onClose,
}: {
  selected: Vid2VidStyle | null
  onSelect: (s: Vid2VidStyle) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? vid2vidStyles.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.description.toLowerCase().includes(query.toLowerCase())
      )
    : vid2vidStyles

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-[#18181f] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-100">选择风格</h3>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/8 rounded-lg px-2.5 py-1.5 w-44">
              <Search className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索风格..."
                className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-600 outline-none"
              />
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          {filtered.length > 0 ? (
            <div className="grid grid-cols-4 gap-2.5">
              {filtered.map((style) => (
                <StyleCard
                  key={style.id}
                  style={style}
                  selected={selected?.id === style.id}
                  onSelect={() => {
                    onSelect(style)
                    onClose()
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-500 text-sm py-10">未找到匹配风格</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Reference subject image ──────────────────────────────────────────────────
interface RefImage {
  file_id: string
  preview: string
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Vid2Vid() {
  useDocumentTitle('视频生成视频')

  const { balance, fetchBalance } = useCreditStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Upload state
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null)
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null)
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // Style state
  const [selectedStyle, setSelectedStyle] = useState<Vid2VidStyle>(vid2vidStyles[0])
  const [showStyleModal, setShowStyleModal] = useState(false)

  // Reference subject images
  const [refImages, setRefImages] = useState<RefImage[]>([])
  const [uploadingRef, setUploadingRef] = useState(false)

  // Settings state
  const [selectedModel, setSelectedModel] = useState<Vid2VidModel>(vid2vidModels[0])
  const [outputCount, setOutputCount] = useState<OutputCount>(1)
  const [ratio, setRatio] = useState<string>('16:9')
  const [duration, setDuration] = useState<number>(5)
  const [customPrompt, setCustomPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')

  const videoInputRef = useRef<HTMLInputElement>(null)
  const refImageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  const totalCredits = selectedModel.credits * outputCount

  // ── Upload source video ─────────────────────────────────────────────────────
  const processVideoFile = async (file: File) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo']
    if (!allowed.includes(file.type)) {
      setError('仅支持 MP4、WebM、MOV 格式')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('文件大小不能超过 50MB')
      return
    }

    setUploading(true)
    setError('')
    setResult(null)
    setUploadedVideo(file)
    setUploadedVideoUrl(URL.createObjectURL(file))

    try {
      const resp = await studioService.upload(file)
      setUploadedVideoId(resp.file_id)
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || '上传失败')
      setUploadedVideo(null)
      setUploadedVideoUrl(null)
    } finally {
      setUploading(false)
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processVideoFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processVideoFile(file)
  }

  const handleUseSample = (url: string) => {
    setUploadedVideoUrl(url)
    setUploadedVideoId(url) // 静态样例路径直接作为 video_id 传后端(后端识别 /api/v1/static/)
    setUploadedVideo(null)
    setError('')
    setResult(null)
  }

  const clearVideo = () => {
    setUploadedVideo(null)
    setUploadedVideoUrl(null)
    setUploadedVideoId(null)
    setResult(null)
    setError('')
    if (videoInputRef.current) videoInputRef.current.value = ''
  }

  // ── Reference subject images ──────────────────────────────────────────────────
  const handleRefImagesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadingRef(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const resp = await studioService.upload(file)
        setRefImages((prev) => [...prev, { file_id: resp.file_id, preview: URL.createObjectURL(file) }])
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || '参考图上传失败')
    } finally {
      setUploadingRef(false)
    }
  }

  const removeRefImage = (fileId: string) => {
    setRefImages((prev) => prev.filter((r) => r.file_id !== fileId))
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!uploadedVideoId) {
      setError('请先上传视频')
      return
    }
    if (balance < totalCredits) {
      setError(`积分不足，需要 ${totalCredits} 积分`)
      return
    }

    setGenerating(true)
    setError('')
    setResult(null)
    setProgress(0)
    setProgressLabel('提交任务...')

    try {
      const task = await studioService.createVideo2Video({
        prompt: customPrompt.trim() || '按参考风格转绘该视频',
        video_id: uploadedVideoId,
        style_id: selectedStyle.id,
        style_prompt: selectedStyle.prompt,
        reference_image_ids: refImages.map((r) => r.file_id),
        negative_prompt: negativePrompt.trim() || undefined,
        ratio,
        duration,
        output_count: outputCount,
        model_id: selectedModel.id,
      })

      const final = await studioService.pollTask(task.task_id, (p, status) => {
        setProgress(p)
        setProgressLabel(
          status === 'processing' ? `处理中 ${p}%` : status === 'pending' ? '排队中...' : status
        )
      })

      if (final.status === 'completed' && final.result_url) {
        setResult(final.result_url)
        await fetchBalance()
      } else {
        throw new Error(final.error || '生成失败，请重试')
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || '生成失败')
    } finally {
      setGenerating(false)
      setProgress(0)
      setProgressLabel('')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex-1 overflow-y-auto">
          <div className="h-full">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] h-full">

              {/* ══════════════ LEFT COLUMN ══════════════ */}
              <div className="overflow-y-auto p-4 md:p-5 space-y-5">

                {/* ── Upload Video ─────────────────────────────────────── */}
                <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5">
                  <h2 className="text-base font-semibold text-gray-100 mb-4 flex items-center gap-2">
                    <Video className="w-4 h-4 text-purple-400" />
                    上传视频
                  </h2>

                  {uploadedVideoUrl ? (
                    <div className="relative">
                      <div className="rounded-xl overflow-hidden bg-black aspect-video">
                        <video key={uploadedVideoUrl} src={uploadedVideoUrl} controls muted className="w-full h-full object-contain" />
                      </div>
                      <button
                        onClick={clearVideo}
                        className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-black/80 backdrop-blur-sm rounded-full flex items-center justify-center transition-colors"
                      >
                        <X className="w-3.5 h-3.5 text-white" />
                      </button>
                      {uploadedVideo && (
                        <p className="mt-2 text-xs text-gray-500 truncate">
                          {uploadedVideo.name} ({(uploadedVideo.size / 1024 / 1024).toFixed(1)} MB)
                        </p>
                      )}
                      {uploading && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-purple-400">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          上传中...
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer ${
                        isDragging
                          ? 'border-purple-500/60 bg-purple-500/5'
                          : 'border-white/10 hover:border-purple-500/30 hover:bg-white/[0.02]'
                      }`}
                      onClick={() => videoInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                    >
                      <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center">
                        <Upload className="w-6 h-6 text-purple-400" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-gray-300 font-medium">上传视频或拖拽文件至此处</p>
                        <p className="text-xs text-gray-600 mt-1">支持 MP4、WebM、MOV，最大 50 MB，建议时长 ≤15 秒</p>
                      </div>
                      <button className="px-4 py-1.5 bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-sm rounded-lg transition-colors border border-purple-500/20">
                        选择文件
                      </button>
                    </div>
                  )}

                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
                    className="hidden"
                    onChange={handleFileInputChange}
                  />

                  {/* Sample videos */}
                  <div className="mt-4">
                    <p className="text-xs text-gray-500 mb-2">或使用样例视频：</p>
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                      {sampleVideos.map((sv) => (
                        <button
                          key={sv.id}
                          onClick={() => handleUseSample(sv.url)}
                          className={`flex-shrink-0 relative rounded-lg overflow-hidden transition-all group border ${
                            uploadedVideoUrl === sv.url
                              ? 'ring-2 ring-pink-500 border-pink-500/40'
                              : 'border-white/5 hover:border-white/20'
                          }`}
                          style={{ width: 80 }}
                        >
                          <div className="aspect-video bg-[#1a1a2e] overflow-hidden">
                            <video
                              src={sv.url}
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              className="w-full h-full object-cover"
                              onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                              onMouseLeave={(e) => {
                                const v = e.target as HTMLVideoElement
                                v.pause()
                                v.currentTime = 0
                              }}
                            />
                          </div>
                          <div className="px-1.5 py-1 bg-[#1a1a2e]">
                            <p className="text-[10px] text-gray-400 truncate">{sv.name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Style Selection ──────────────────────────────────── */}
                <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
                      <span className="text-lg">🎨</span>
                      风格选择
                    </h2>
                    <button
                      onClick={() => setShowStyleModal(true)}
                      className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/20"
                    >
                      <Search className="w-3 h-3" />
                      全部风格
                    </button>
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
                    {vid2vidStyles.map((style) => (
                      <div key={style.id} className="flex-shrink-0 w-[108px]">
                        <StyleCard
                          style={style}
                          selected={selectedStyle.id === style.id}
                          onSelect={() => setSelectedStyle(style)}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center gap-2.5 px-3 py-2 bg-purple-500/5 rounded-lg border border-purple-500/15">
                    <div className="w-8 h-8 rounded-md flex-shrink-0 overflow-hidden" style={{ background: selectedStyle.gradient }}>
                      {selectedStyle.previewImage && (
                        <img
                          src={selectedStyle.previewImage}
                          alt={selectedStyle.name}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-purple-200 truncate">{selectedStyle.name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{selectedStyle.description}</p>
                    </div>
                    <span className="text-[10px] text-purple-400/60 font-medium">{selectedStyle.version}</span>
                  </div>
                </div>

                {/* ── Reference Subjects (Elements) ────────────────────── */}
                <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-purple-400" />
                      参考主体
                    </h2>
                    <span className="text-[11px] text-gray-500">可选 · 引导人物/物体形象</span>
                  </div>
                  <p className="text-xs text-gray-600 mb-3">上传参考图，让生成视频保留指定主体的形象特征。</p>

                  <div className="flex flex-wrap gap-2.5">
                    {refImages.map((r) => (
                      <div key={r.file_id} className="relative w-20 h-20 rounded-lg overflow-hidden border border-white/10 group">
                        <img src={r.preview} alt="ref" className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeRefImage(r.file_id)}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/70 hover:bg-red-500/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3 text-white" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => refImageInputRef.current?.click()}
                      disabled={uploadingRef}
                      className="w-20 h-20 rounded-lg border-2 border-dashed border-white/10 hover:border-purple-500/40 flex flex-col items-center justify-center text-gray-500 hover:text-purple-400 transition-colors disabled:opacity-50"
                    >
                      {uploadingRef ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-5 h-5" />
                          <span className="text-[10px] mt-0.5">添加</span>
                        </>
                      )}
                    </button>
                  </div>
                  <input
                    ref={refImageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => { handleRefImagesSelected(e.target.files); e.target.value = '' }}
                  />
                </div>

                {/* ── Result ──────────────────────────────────────────── */}
                {result && (
                  <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5">
                    <h3 className="text-base font-semibold text-gray-100 mb-4 flex items-center gap-2">
                      <Play className="w-4 h-4 text-pink-400" />
                      生成结果
                    </h3>
                    <div className="flex justify-center">
                      <video src={studioService.getResultUrl(result)} controls autoPlay className="max-w-full max-h-[400px] rounded-xl" />
                    </div>
                    <div className="mt-4 flex justify-center">
                      <a
                        href={studioService.getResultUrl(result)}
                        download
                        className="flex items-center gap-2 px-5 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 transition-all text-sm"
                      >
                        <Download className="w-4 h-4" />
                        下载视频
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* ══════════════ RIGHT COLUMN ══════════════ */}
              <div className="overflow-y-auto border-l border-white/5 p-4 md:p-5">
                <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5 space-y-5">
                  <h2 className="text-base font-semibold text-gray-100">设置</h2>

                  {/* ── Model ─────────────────────────────────────────── */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-3">AI 模型</label>
                    <div className="space-y-2.5">
                      {vid2vidModels.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => setSelectedModel(model)}
                          className={`w-full p-3.5 rounded-xl text-left transition-all border ${
                            selectedModel.id === model.id
                              ? 'bg-purple-500/10 border-purple-500/40'
                              : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                selectedModel.id === model.id ? 'border-pink-500 bg-pink-500' : 'border-gray-600'
                              }`}
                            >
                              {selectedModel.id === model.id && <div className="w-2 h-2 rounded-full bg-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-gray-100 text-sm">{model.name}</span>
                                <span className="text-[10px] text-gray-500">{model.provider}</span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">{model.description}</p>
                              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                                <span className="flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  质量 {model.quality}/5
                                </span>
                                <span className="flex items-center gap-1">
                                  <Coins className="w-3 h-3" />
                                  {model.credits} 积分
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Aspect ratio ──────────────────────────────────── */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">画面比例</label>
                    <div className="flex gap-2">
                      {ratioOptions.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setRatio(r.id)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                            ratio === r.id
                              ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                              : 'bg-white/[0.03] text-gray-400 border-white/5 hover:bg-white/[0.06]'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Duration ──────────────────────────────────────── */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">时长</label>
                    <div className="flex gap-2">
                      {durationOptions.map((d) => (
                        <button
                          key={d}
                          onClick={() => setDuration(d)}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all border ${
                            duration === d
                              ? 'bg-pink-500 text-white border-pink-500 shadow-lg shadow-pink-500/20'
                              : 'bg-white/[0.03] text-gray-400 border-white/5 hover:bg-white/[0.06]'
                          }`}
                        >
                          {d}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Output Count ──────────────────────────────────── */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">输出视频数量</label>
                    <div className="flex gap-2">
                      {outputCountOptions.map((n) => (
                        <button
                          key={n}
                          onClick={() => setOutputCount(n)}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all border ${
                            outputCount === n
                              ? 'bg-pink-500 text-white border-pink-500 shadow-lg shadow-pink-500/20'
                              : 'bg-white/[0.03] text-gray-400 border-white/5 hover:bg-white/[0.06]'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Advanced (collapsible) ─────────────────────────── */}
                  <div>
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex items-center justify-between w-full text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors"
                    >
                      <span>高级设置</span>
                      {showAdvanced ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </button>

                    {showAdvanced && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1.5">附加描述（可选）</label>
                          <textarea
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            placeholder="例如：保留人物动作，增强色彩饱和度..."
                            rows={3}
                            className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-3 py-2.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40 resize-none text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1.5">负向提示词（可选）</label>
                          <textarea
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            placeholder="不希望出现的内容，例如：模糊、扭曲、多余的手指..."
                            rows={2}
                            className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-3 py-2.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40 resize-none text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/5" />

                  {/* ── Credits Required ──────────────────────────────── */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-red-400 text-xs flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                      所需积分
                    </span>
                    <span className="text-gray-100 font-semibold">{totalCredits} 积分</span>
                  </div>

                  {/* ── Generate Button ───────────────────────────────── */}
                  <button
                    onClick={handleGenerate}
                    disabled={generating || uploading || !uploadedVideoId}
                    className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                      generating || uploading || !uploadedVideoId
                        ? 'bg-gray-800/80 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 bg-[length:200%_auto] text-white hover:bg-right-top shadow-lg shadow-pink-500/20 hover:shadow-pink-500/30'
                    }`}
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {progressLabel || '生成中...'}
                      </>
                    ) : uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        上传中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        开始创作
                      </>
                    )}
                  </button>

                  {generating && progress > 0 && (
                    <div className="w-full bg-white/5 rounded-full h-1.5">
                      <div
                        className="bg-gradient-to-r from-purple-500 to-pink-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

                  {/* ── Cost summary ──────────────────────────────────── */}
                  <div className="pt-2 border-t border-white/5 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>账户余额</span>
                      <span className="text-gray-300">{Math.round(balance)} 积分</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>模型费用</span>
                      <span className="text-gray-300">{selectedModel.credits} × {outputCount} 个</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>选择风格</span>
                      <span className="text-purple-400">{selectedStyle.name}</span>
                    </div>
                    {refImages.length > 0 && (
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>参考主体</span>
                        <span className="text-purple-400">{refImages.length} 张</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>预计消耗</span>
                      <span className="text-pink-400 font-semibold">{totalCredits} 积分</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {showStyleModal && (
        <StyleModal selected={selectedStyle} onSelect={setSelectedStyle} onClose={() => setShowStyleModal(false)} />
      )}
    </div>
  )
}
