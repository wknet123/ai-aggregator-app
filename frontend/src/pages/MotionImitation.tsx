import { useState, useEffect, useRef, useCallback } from 'react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { studioService } from '../services/studio.service'
import { useCreditStore } from '../store/credit.store'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  motionCategories,
  motionModels,
  getTemplatesByCategory,
  MotionTemplate,
  MotionModel,
} from '../data/motionTemplates'
import {
  Loader2,
  Play,
  Download,
  Upload,
  Check,
  Clock,
  Sparkles,
  ImageIcon,
  X,
  Coins,
  ArrowRight,
  Pause,
} from 'lucide-react'

// ─── Video Thumbnail Card ────────────────────────────────────────────
function VideoCard({
  template,
  selected,
  onSelect,
}: {
  template: MotionTemplate
  selected: boolean
  onSelect: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isHovering, setIsHovering] = useState(false)

  const handleMouseEnter = () => {
    setIsHovering(true)
    videoRef.current?.play().catch(() => {})
  }

  const handleMouseLeave = () => {
    setIsHovering(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  return (
    <button
      onClick={onSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative rounded-xl overflow-hidden transition-all duration-200 group ${
        selected
          ? 'ring-2 ring-pink-500 shadow-lg shadow-pink-500/20 scale-[1.02]'
          : 'ring-1 ring-white/5 hover:ring-purple-500/30'
      }`}
    >
      {/* Video / Thumbnail */}
      <div className="aspect-[3/4] bg-[#1a1a2e] relative overflow-hidden">
        <video
          ref={videoRef}
          src={template.previewUrl}
          muted
          loop
          playsInline
          preload="metadata"
          className="w-full h-full object-cover"
        />

        {/* Gradient overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />

        {/* Play Button Overlay */}
        {!isHovering && !selected && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center border border-white/20">
              <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
            </div>
          </div>
        )}

        {/* Playing indicator */}
        {isHovering && (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-2 py-0.5">
            <div className="flex items-end gap-[2px] h-3">
              <div className="w-[2px] bg-pink-400 rounded-full animate-[bounce_0.6s_ease-in-out_infinite]" style={{ height: '60%' }} />
              <div className="w-[2px] bg-pink-400 rounded-full animate-[bounce_0.6s_ease-in-out_infinite_0.15s]" style={{ height: '100%' }} />
              <div className="w-[2px] bg-pink-400 rounded-full animate-[bounce_0.6s_ease-in-out_infinite_0.3s]" style={{ height: '40%' }} />
            </div>
          </div>
        )}

        {/* Selected Checkmark */}
        {selected && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center shadow-lg animate-[scale-in_0.2s_ease-out]">
            <Check className="w-3.5 h-3.5 text-white" />
          </div>
        )}

        {/* Badge */}
        {template.badge && (
          <span
            className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded ${
              template.badge === 'HOT'
                ? 'bg-orange-500 text-white'
                : 'bg-blue-500 text-white'
            }`}
          >
            {template.badge === 'HOT' ? '🔥 HOT' : 'NEW'}
          </span>
        )}

        {/* Duration */}
        <span className="absolute bottom-2 right-2 text-[11px] bg-black/60 backdrop-blur-sm text-white/90 px-1.5 py-0.5 rounded">
          {template.duration}
        </span>
      </div>

      {/* Name */}
      <div className="px-2 py-2 text-left">
        <p className={`text-sm truncate transition-colors ${selected ? 'text-pink-300' : 'text-gray-200'}`}>
          {template.name}
        </p>
      </div>
    </button>
  )
}

// ─── Main Page Component ─────────────────────────────────────────────
export default function MotionImitation() {
  useDocumentTitle('动作模仿')

  const { balance, fetchBalance } = useCreditStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Left panel — 你的照片
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null)
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Left panel — 动作参考
  const [selectedCategory, setSelectedCategory] = useState('trending')
  const [selectedTemplate, setSelectedTemplate] = useState<MotionTemplate | null>(null)

  // Custom video
  const [customVideoUrl, setCustomVideoUrl] = useState<string | null>(null)
  const [customVideoId, setCustomVideoId] = useState<string | null>(null)
  const [uploadingVideo, setUploadingVideo] = useState(false)

  // Right panel — 设置
  const [selectedModel, setSelectedModel] = useState<MotionModel>(motionModels[0])
  const [motionPrompt, setMotionPrompt] = useState('')
  const [characterOrientation, setCharacterOrientation] = useState<'image' | 'video'>('image')
  const [keepOriginalSound, setKeepOriginalSound] = useState(true)

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Preview
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const previewVideoRef = useRef<HTMLVideoElement>(null)

  const photoInputRef = useRef<HTMLInputElement>(null)
  const customVideoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  const categoryTemplates = getTemplatesByCategory(selectedCategory)
  const isKling = selectedModel.id.startsWith('kling')

  // ─── Photo Upload ───
  const handlePhotoUpload = useCallback(async (file: File) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setError('请上传 JPEG, PNG 或 WebP 格式的图片')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('图片大小不能超过 10MB')
      return
    }

    setUploadedPreview(URL.createObjectURL(file))
    setUploading(true)
    setError('')

    try {
      const res = await studioService.upload(file)
      setUploadedFileId(res.file_id)
    } catch {
      setError('图片上传失败，请重试')
      setUploadedPreview(null)
      setUploadedFileId(null)
    } finally {
      setUploading(false)
    }
  }, [])

  const handleRemovePhoto = () => {
    if (uploadedPreview) URL.revokeObjectURL(uploadedPreview)
    setUploadedPreview(null)
    setUploadedFileId(null)
  }

  // ─── Drag & Drop ───
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      handlePhotoUpload(file)
    }
  }, [handlePhotoUpload])

  // ─── Custom Video Upload ───
  const handleRemoveCustomVideo = useCallback(() => {
    if (customVideoUrl) URL.revokeObjectURL(customVideoUrl)
    setCustomVideoUrl(null)
    setCustomVideoId(null)
  }, [customVideoUrl])

  const handleCustomVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSelectedTemplate(null)
    setCustomVideoUrl(URL.createObjectURL(file))
    setUploadingVideo(true)
    setError('')
    try {
      const res = await studioService.upload(file)
      setCustomVideoId(res.file_id)
    } catch {
      setError('动作视频上传失败，请重试')
      handleRemoveCustomVideo()
    } finally {
      setUploadingVideo(false)
    }
  }

  // ─── Preview toggle ───
  const togglePreview = () => {
    if (!previewVideoRef.current) return
    if (previewPlaying) {
      previewVideoRef.current.pause()
    } else {
      previewVideoRef.current.play().catch(() => {})
    }
    setPreviewPlaying(!previewPlaying)
  }

  // ─── Generate ───
  const handleGenerate = async () => {
    if (!uploadedFileId) {
      setError('请先上传人物照片')
      return
    }
    if (!selectedTemplate && !customVideoId) {
      setError('请选择动作模板或上传自定义动作视频')
      return
    }
    if (balance < selectedModel.credits) {
      setError(`积分不足。需要 ${selectedModel.credits} 积分`)
      return
    }

    setGenerating(true)
    setError('')
    setResult(null)
    setProgress(0)

    try {
      const task = await studioService.createMotion({
        character_image_id: uploadedFileId,
        motion_video_id: customVideoId || undefined,
        motion_template: selectedTemplate?.previewUrl,
        model_id: selectedModel.id,
        character_orientation: characterOrientation,
        keep_original_sound: keepOriginalSound ? 'yes' : 'no',
        prompt: motionPrompt || undefined,
      })
      const final = await studioService.pollTask(task.task_id, (p) => setProgress(p))
      if (final.status === 'completed' && final.result_url) {
        setResult(final.result_url)
        await fetchBalance()
      } else {
        throw new Error(final.error || '生成失败')
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const hasMotion = !!selectedTemplate || !!customVideoId
  const isReady = !!uploadedFileId && hasMotion
  const motionPreviewUrl = selectedTemplate?.previewUrl || customVideoUrl

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex-1 overflow-y-auto">
          <div className="h-full">
            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] h-full">
              {/* ════════════ LEFT COLUMN ════════════ */}
              <div className="overflow-y-auto p-4 md:p-5 space-y-5">
                {/* ── Your Photo Card ── */}
                <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5">
                  <h2 className="text-base font-semibold text-gray-100 mb-4 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-purple-400" />
                    你的照片
                    {uploadedFileId && (
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        <Check className="w-3 h-3" />
                        已就绪
                      </span>
                    )}
                  </h2>

                  <input
                    type="file"
                    ref={photoInputRef}
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handlePhotoUpload(f)
                      e.target.value = ''
                    }}
                  />

                  {uploadedPreview ? (
                    <div className="relative inline-block group">
                      <img
                        src={uploadedPreview}
                        alt="Uploaded"
                        className="max-h-[200px] rounded-xl object-contain bg-black/30"
                      />
                      {uploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl">
                          <Loader2 className="w-6 h-6 animate-spin text-pink-500" />
                        </div>
                      )}
                      {!uploading && (
                        <div
                          onClick={() => photoInputRef.current?.click()}
                          className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                        >
                          <span className="text-xs text-white bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-lg">
                            更换照片
                          </span>
                        </div>
                      )}
                      <button
                        onClick={handleRemovePhoto}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors"
                      >
                        <X className="w-3.5 h-3.5 text-white" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => photoInputRef.current?.click()}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`w-full h-[180px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all ${
                        dragOver
                          ? 'border-pink-400 bg-pink-500/5 text-pink-400'
                          : 'border-purple-500/20 text-gray-500 hover:border-purple-400/40 hover:text-purple-400'
                      }`}
                    >
                      <Upload className="w-10 h-10 mb-3 stroke-[1.5]" />
                      <span className="text-sm font-medium">
                        {dragOver ? '松开以上传' : '上传照片'}
                      </span>
                      <span className="text-xs text-gray-600 mt-1">全身照效果最佳</span>
                      <span className="text-[11px] text-gray-700 mt-2">
                        支持拖拽上传 · JPEG, PNG, WebP
                      </span>
                    </button>
                  )}
                </div>

                {/* ── Motion Reference Card ── */}
                <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5">
                  <h2 className="text-base font-semibold text-gray-100 mb-4 flex items-center gap-2">
                    <span className="text-lg">🎬</span>
                    动作参考
                    {hasMotion && (
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        <Check className="w-3 h-3" />
                        已选择
                      </span>
                    )}
                  </h2>

                  {/* Category Tabs */}
                  <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1 scrollbar-none">
                    {motionCategories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => {
                          setSelectedCategory(cat.id)
                          if (cat.id !== 'custom') {
                            handleRemoveCustomVideo()
                          }
                        }}
                        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-all border ${
                          selectedCategory === cat.id
                            ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                            : 'bg-white/[0.03] text-gray-400 border-white/5 hover:bg-white/[0.06] hover:text-gray-300'
                        }`}
                      >
                        <span>{cat.icon}</span>
                        {cat.name}
                      </button>
                    ))}
                  </div>

                  {/* Templates Grid or Custom Upload */}
                  {selectedCategory === 'custom' ? (
                    <div>
                      <input
                        type="file"
                        ref={customVideoInputRef}
                        accept="video/*"
                        className="hidden"
                        onChange={handleCustomVideoChange}
                      />
                      {customVideoUrl ? (
                        <div className="relative">
                          <video
                            src={customVideoUrl}
                            controls
                            className="w-full max-h-[320px] rounded-xl object-contain bg-black"
                          />
                          {uploadingVideo && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl">
                              <Loader2 className="w-6 h-6 animate-spin text-pink-500" />
                            </div>
                          )}
                          <button
                            onClick={handleRemoveCustomVideo}
                            className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-black/80 backdrop-blur-sm rounded-full flex items-center justify-center transition-colors"
                          >
                            <X className="w-4 h-4 text-white" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => customVideoInputRef.current?.click()}
                          className="w-full h-[200px] border-2 border-dashed border-purple-500/20 rounded-xl flex flex-col items-center justify-center text-gray-500 hover:border-purple-400/40 hover:text-purple-400 transition-all"
                        >
                          <Upload className="w-10 h-10 mb-3 stroke-[1.5]" />
                          <span className="text-sm font-medium">上传动作视频</span>
                          <span className="text-xs text-gray-600 mt-1">支持 MP4, MOV 格式</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {categoryTemplates.map((template) => (
                        <VideoCard
                          key={template.id}
                          template={template}
                          selected={selectedTemplate?.id === template.id}
                          onSelect={() => {
                            setSelectedTemplate(
                              selectedTemplate?.id === template.id ? null : template
                            )
                            handleRemoveCustomVideo()
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Result ── */}
                {result && (
                  <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5">
                    <h3 className="text-base font-semibold text-gray-100 mb-4 flex items-center gap-2">
                      <Play className="w-4 h-4 text-pink-400" />
                      生成结果
                    </h3>
                    <div className="flex justify-center">
                      <video
                        src={studioService.getResultUrl(result)}
                        controls
                        autoPlay
                        className="max-w-full max-h-[400px] rounded-xl"
                      />
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

              {/* ════════════ RIGHT COLUMN ════════════ */}
              <div className="overflow-y-auto border-l border-white/5 flex flex-col">
                <div className="flex-1 p-4 md:p-5 space-y-5">

                  {/* ── Combined Preview ── */}
                  <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">预览</h3>
                    <div className="flex items-center gap-3">
                      {/* Photo thumbnail */}
                      <div className="flex-1 min-w-0">
                        {uploadedPreview ? (
                          <div className="aspect-[3/4] rounded-xl overflow-hidden bg-black/30 relative">
                            <img src={uploadedPreview} alt="Photo" className="w-full h-full object-cover" />
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                              <p className="text-[10px] text-white/80 text-center">人物照片</p>
                            </div>
                          </div>
                        ) : (
                          <div className="aspect-[3/4] rounded-xl border border-dashed border-white/10 flex flex-col items-center justify-center bg-white/[0.02]">
                            <ImageIcon className="w-6 h-6 text-gray-600 mb-1" />
                            <p className="text-[10px] text-gray-600">等待上传</p>
                          </div>
                        )}
                      </div>

                      {/* Arrow */}
                      <div className="flex-shrink-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                          isReady ? 'bg-pink-500/20 text-pink-400' : 'bg-white/5 text-gray-600'
                        }`}>
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </div>

                      {/* Motion thumbnail */}
                      <div className="flex-1 min-w-0">
                        {motionPreviewUrl ? (
                          <div
                            className="aspect-[3/4] rounded-xl overflow-hidden bg-black/30 relative cursor-pointer group"
                            onClick={togglePreview}
                          >
                            <video
                              ref={previewVideoRef}
                              src={motionPreviewUrl}
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              className="w-full h-full object-cover"
                              onPlay={() => setPreviewPlaying(true)}
                              onPause={() => setPreviewPlaying(false)}
                            />
                            <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${previewPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                              <div className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center border border-white/20">
                                {previewPlaying
                                  ? <Pause className="w-3 h-3 text-white" fill="white" />
                                  : <Play className="w-3 h-3 text-white ml-0.5" fill="white" />
                                }
                              </div>
                            </div>
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                              <p className="text-[10px] text-white/80 text-center truncate">
                                {selectedTemplate?.name || '自定义动作'}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="aspect-[3/4] rounded-xl border border-dashed border-white/10 flex flex-col items-center justify-center bg-white/[0.02]">
                            <Play className="w-6 h-6 text-gray-600 mb-1" />
                            <p className="text-[10px] text-gray-600">等待选择</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Step indicators */}
                    <div className="flex items-center gap-2 mt-3">
                      <div className={`flex-1 h-1 rounded-full transition-colors ${uploadedFileId ? 'bg-emerald-500' : 'bg-white/5'}`} />
                      <div className={`flex-1 h-1 rounded-full transition-colors ${hasMotion ? 'bg-emerald-500' : 'bg-white/5'}`} />
                      <div className={`flex-1 h-1 rounded-full transition-colors ${result ? 'bg-emerald-500' : 'bg-white/5'}`} />
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-600">
                      <span className={uploadedFileId ? 'text-emerald-400' : ''}>1. 上传照片</span>
                      <span className={hasMotion ? 'text-emerald-400' : ''}>2. 选择动作</span>
                      <span className={result ? 'text-emerald-400' : ''}>3. 生成</span>
                    </div>
                  </div>

                  {/* ── Settings ── */}
                  <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 p-5">
                    <h2 className="text-base font-semibold text-gray-100 mb-5">设置</h2>

                    {/* AI Model Selection */}
                    <div className="mb-5">
                      <label className="block text-sm font-medium text-gray-300 mb-3">AI 模型</label>
                      <div className="space-y-2.5">
                        {motionModels.map((model) => (
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
                                  selectedModel.id === model.id
                                    ? 'border-pink-500 bg-pink-500'
                                    : 'border-gray-600'
                                }`}
                              >
                                {selectedModel.id === model.id && (
                                  <div className="w-2 h-2 rounded-full bg-white" />
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-gray-100 text-sm">{model.name}</span>
                                  {model.trueMimic && (
                                    <span className="text-[10px] font-bold bg-gradient-to-r from-pink-500 to-purple-500 text-white px-1.5 py-0.5 rounded">
                                      Mimic
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {model.description}
                                  {model.provider !== model.name && (
                                    <span className="text-gray-600"> ({model.provider})</span>
                                  )}
                                </p>
                                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {model.processingTime}
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

                    {/* Kling 动作控制专属选项 */}
                    {selectedModel.id === 'kling-motion-control' && (
                      <div className="mb-5 space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-2">角色面向</label>
                          <div className="flex gap-2">
                            {([['image', '跟随照片'], ['video', '跟随视频']] as const).map(([val, txt]) => (
                              <button
                                key={val}
                                onClick={() => setCharacterOrientation(val)}
                                className={`flex-1 py-2 rounded-lg text-xs border transition-all ${
                                  characterOrientation === val
                                    ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                                    : 'bg-white/[0.03] text-gray-400 border-white/5 hover:text-gray-300'
                                }`}
                              >
                                {txt}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={keepOriginalSound}
                            onChange={(e) => setKeepOriginalSound(e.target.checked)}
                            className="w-4 h-4 rounded accent-pink-500"
                          />
                          保留参考视频原声
                        </label>
                      </div>
                    )}

                    {/* Motion Description */}
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">动作描述（可选）</label>
                      <textarea
                        value={motionPrompt}
                        onChange={(e) => setMotionPrompt(e.target.value)}
                        placeholder="例如：流畅的舞蹈动作，挥手..."
                        className="w-full h-20 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40 resize-none text-sm"
                        disabled={generating}
                      />
                    </div>
                  </div>

                  {/* Balance Summary */}
                  <div className="bg-[#14141c] rounded-2xl border border-purple-500/10 px-5 py-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>账户余额</span>
                        <span className="text-gray-300">{Math.round(balance)} 积分</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>预计消耗</span>
                        <span className="text-pink-400">{selectedModel.credits} 积分</span>
                      </div>
                      {selectedTemplate && (
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>已选动作</span>
                          <span className="text-purple-400">{selectedTemplate.name}</span>
                        </div>
                      )}
                      {customVideoId && (
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>已选动作</span>
                          <span className="text-purple-400">自定义视频</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Sticky Generate Button ── */}
                <div className="sticky bottom-0 p-4 md:px-5 md:pb-5 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f] to-transparent pt-6">
                  <button
                    onClick={handleGenerate}
                    disabled={generating || !isReady || uploading || uploadingVideo}
                    className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                      generating || !isReady || uploading || uploadingVideo
                        ? 'bg-gray-800/80 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 bg-[length:200%_auto] text-white hover:bg-right-top shadow-lg shadow-pink-500/20 hover:shadow-pink-500/30'
                    }`}
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        生成中 {progress}%
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        生成动作迁移视频
                      </>
                    )}
                  </button>

                  {error && (
                    <p className="mt-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
