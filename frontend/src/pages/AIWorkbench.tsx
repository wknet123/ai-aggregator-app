import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import CompactConfigBar from '../components/model/CompactConfigBar'
import ImageUploader, { UploadedImage } from '../components/model/ImageUploader'
import { CATEGORIES, getModelsByCategory } from '../config/models.config'
import { calculateCost } from '../config/models.config'
import type { ModelCategory } from '../types/model.types'
import { useCreditStore } from '../store/credit.store'
import { modelService } from '../services/model.service'
import { googleService, buildUploadPreviewUrl, type HistoryItem } from '../services/google.service'
import { useCreditUtils } from '../utils/credit.utils'
import CreditErrorBanner, { isInsufficientCredit } from '../components/CreditErrorBanner'
import { useDocumentTitle, PAGE_TITLES } from '../hooks/useDocumentTitle'
import { Loader2, CheckCircle, XCircle, Download, X, Send, ChevronLeft, ChevronRight, Sparkles, Play, Video, ImageIcon, Palette, RefreshCw, Phone, Cake, Building2, Wand2, Upload } from 'lucide-react'
import { getQuickPrompts, polishPrompt, QuickPrompt } from '../services/prompt.service'

// Sub-type definitions for video and image categories
type VideoSubType = 'text-to-video' | 'image-to-video'
type ImageSubType = 'text-to-image' | 'image-to-image'

// Default showcase items when no history exists
const DEFAULT_SHOWCASE = {
  image: [
    { id: 'default-1', title: 'Wan 2.7 图像', subtitle: '文生图 / 图生图，高质量输出', prompt: '' },
    { id: 'default-2', title: 'Wan 2.7 Pro', subtitle: '更强细节与指令遵循', prompt: '' },
  ],
  video: [
    { id: 'default-1', title: '海螺 Hailuo 2.3', subtitle: '文生视频 / 图生视频', prompt: '' },
    { id: 'default-2', title: 'HappyHorse 1.0', subtitle: '多参考图视频生成', prompt: '' },
  ]
}

// Chat message type
interface ChatMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  imageUrl?: string
  videoUrl?: string
  timestamp: Date
  status?: 'pending' | 'generating' | 'completed' | 'failed'
  progress?: number
  task_id?: string
  model_id?: string
  parameters?: any
  prompt?: string  // originating prompt, mirrored onto the assistant bubble so refill is self-contained
}

// Rebuild a chat thread from history items (newest-first from the API). Each item
// becomes a user prompt bubble followed by a completed result bubble. Rendered oldest
// → newest so the thread reads top-to-bottom like a live conversation. The assistant
// bubble carries task_id/model_id/parameters/prompt — everything applyRefill needs.
function buildChatFromHistory(items: HistoryItem[]): ChatMessage[] {
  const ordered = [...items].reverse() // API is newest-first; show oldest at top
  const messages: ChatMessage[] = []
  for (const item of ordered) {
    const isVideo = item.task_type === 'video'
    const ts = item.created_at ? new Date(item.created_at) : new Date()
    messages.push({
      id: `${item.task_id}-u`,
      type: 'user',
      content: item.prompt,
      timestamp: ts,
    })
    messages.push({
      id: `${item.task_id}-a`,
      type: 'assistant',
      content: isVideo ? '视频生成成功！' : '图像生成成功！',
      imageUrl: isVideo ? undefined : item.result_url,
      videoUrl: isVideo ? item.result_url : undefined,
      timestamp: ts,
      status: 'completed',
      task_id: item.task_id,
      model_id: item.model_id,
      parameters: item.parameters || {},
      prompt: item.prompt,
    })
  }
  return messages
}

export default function AIWorkbench() {
  const location = useLocation()
  const navigate = useNavigate()
  const { balance, fetchBalance } = useCreditStore()
  const { formatCredits, hasEnoughCredits } = useCreditUtils()

  // Set page title based on current route
  useDocumentTitle(PAGE_TITLES[location.pathname] || 'AI创作')

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  
  // Carousel state
  const [currentSlide, setCurrentSlide] = useState(0)
  
  // Determine category from route
  const getCategoryFromRoute = (): ModelCategory => {
    if (location.pathname === '/image-generation') return 'image'
    if (location.pathname === '/video-generation') return 'video'
    return 'image'
  }

  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>(getCategoryFromRoute())
  // Sub-type states for video and image
  const [videoSubType, setVideoSubType] = useState<VideoSubType>('text-to-video')
  const [imageSubType, setImageSubType] = useState<ImageSubType>('text-to-image')
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [modelConfig, setModelConfig] = useState<Record<string, any>>({})
  const [prompt, setPrompt] = useState('')
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>([])
  const [isRefreshingPrompts, setIsRefreshingPrompts] = useState(false)
  const [isPolishing, setIsPolishing] = useState(false)
  const [estimatedCost, setEstimatedCost] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<Array<{ prompt: string; result: any; task_id?: string; created_at?: string; model_id?: string; parameters?: any }>>([])
  
  // Chat messages state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const chatContainerRef = useRef<HTMLDivElement>(null)
  
  // Preview modal state (image + video)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [previewVideo, setPreviewVideo] = useState<string | null>(null)

  // New states for Google integration - support multiple frames
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([])
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null) // Legacy support
  // History refill: seed the (uncontrolled) ImageUploader with restored reference frames.
  // Bump `uploaderKey` to force a remount so it re-reads `initialImages`.
  const [refillImages, setRefillImages] = useState<UploadedImage[]>([])
  const [uploaderKey, setUploaderKey] = useState(0)
  
  // Update category when route changes
  useEffect(() => {
    const newCategory = getCategoryFromRoute()
    setSelectedCategory(newCategory)
    // chatMessages are rehydrated from history by the loadHistory effect below
    // (keyed on selectedCategory); it clears then refills, so no reset here.
    setError('')
    // Clear uploaded images when switching categories
    setUploadedImages([])
    setUploadedFileId(null)
    setRefillImages([])
    setUploaderKey((k) => k + 1)
    // Reset sub-types when switching categories
    if (newCategory === 'video') {
      setVideoSubType('text-to-video')
    } else {
      setImageSubType('text-to-image')
    }
  }, [location.pathname])

  // Load dynamic quick prompts on mount and category change
  useEffect(() => {
    let cancelled = false
    getQuickPrompts(selectedCategory as 'image' | 'video').then((prompts) => {
      if (!cancelled) setQuickPrompts(prompts)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedCategory])

  const handleRefreshPrompts = async () => {
    if (isRefreshingPrompts) return
    setIsRefreshingPrompts(true)
    try {
      const prompts = await getQuickPrompts(selectedCategory as 'image' | 'video', true)
      setQuickPrompts(prompts)
    } catch {
      // keep current
    } finally {
      setIsRefreshingPrompts(false)
    }
  }

  const handlePolish = async () => {
    if (!prompt.trim() || isPolishing) return
    setIsPolishing(true)
    try {
      const polished = await polishPrompt(prompt.trim(), selectedCategory as 'image' | 'video')
      setPrompt(polished)
    } catch {
      // silently ignore — user still has their original prompt
    } finally {
      setIsPolishing(false)
    }
  }

  // Fetch balance on mount
  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])
  
  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [chatMessages])

  // Load generation history on mount and category change.
  // Besides feeding the "我的作品" carousel, we rebuild the persistent chat thread so
  // past generations survive reloads / category switches (the chat state itself is
  // in-memory only). Each history item → a user prompt bubble + a completed result bubble.
  useEffect(() => {
    let cancelled = false
    const loadHistory = async () => {
      try {
        const historyData = await googleService.getHistory(selectedCategory as 'image' | 'video', 10)
        if (cancelled) return
        const formattedHistory = historyData.map(item => ({
          prompt: item.prompt,
          result: { url: item.result_url },
          task_id: item.task_id,
          created_at: item.created_at,
          model_id: item.model_id,
          parameters: item.parameters || {}
        }))
        setHistory(formattedHistory)
        setChatMessages(buildChatFromHistory(historyData))
      } catch (err) {
        console.error('Failed to load history:', err)
        if (!cancelled) setChatMessages([])
      }
    }

    loadHistory()
    return () => { cancelled = true }
  }, [selectedCategory])

  // Default to the first available model of the current category
  useEffect(() => {
    const models = getModelsByCategory(selectedCategory)
    const firstEnabled = models.find(m => m.enabled !== false) || models[0]
    setSelectedModelId(firstEnabled ? firstEnabled.id : '')
  }, [selectedCategory])

  // Calculate cost whenever model or config changes
  useEffect(() => {
    if (selectedModelId) {
      const cost = calculateCost(selectedModelId, modelConfig)
      setEstimatedCost(cost)
    }
  }, [selectedModelId, modelConfig])

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('请输入创作描述')
      return
    }

    // Check if image-to-video or image-to-image requires reference image
    const firstFrameId = uploadedImages[0]?.fileId || uploadedFileId
    if (selectedCategory === 'video' && videoSubType === 'image-to-video' && !firstFrameId) {
      setError('请上传参考图片用于图生视频')
      return
    }
    if (selectedCategory === 'image' && imageSubType === 'image-to-image' && !firstFrameId) {
      setError('请上传参考图片用于图生图')
      return
    }

    // Pre-check credits: show an inline notice with a 去充值 link (CreditErrorBanner)
    // instead of a blocking confirm, so the user can click through and return here.
    if (!hasEnoughCredits(estimatedCost)) {
      setError(`积分不足！需要 ${formatCredits(estimatedCost)}，当前余额 ${formatCredits(balance)}`)
      return
    }

    const userMessageId = Date.now().toString()
    const assistantMessageId = (Date.now() + 1).toString()
    
    // Add user message
    const userMessage: ChatMessage = {
      id: userMessageId,
      type: 'user',
      content: prompt,
      timestamp: new Date()
    }
    
    // Add assistant message (generating)
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      type: 'assistant',
      content: '正在生成中...',
      timestamp: new Date(),
      status: 'generating',
      progress: 0
    }
    
    setChatMessages(prev => [...prev, userMessage, assistantMessage])
    setGenerating(true)
    setError('')
    // Keep the prompt visible (read-only via `disabled={generating}`) for the
    // whole generation; only clear it once generation succeeds.
    const currentPrompt = prompt
    let succeeded = false

    try {
      let resultUrl: string | null = null
      let taskResponse

      // Route to appropriate service based on category and model
      switch (selectedCategory) {
        case 'image':
          if (selectedModelId === 'wan2.7-image' || selectedModelId === 'wan2.7-image-pro') {
            // Get reference image ID if uploaded (for image-to-image generation)
            const referenceImageId = imageSubType === 'image-to-image' ? (uploadedImages[0]?.fileId || null) : null

            taskResponse = await googleService.generateImage({
              prompt: currentPrompt,
              model_id: selectedModelId,
              aspect_ratio: modelConfig.aspect_ratio || '4:3',
              reference_image_id: referenceImageId || undefined,
              generation_mode: imageSubType, // Pass sub-type to backend
            })

            const finalImageTask = await googleService.pollTaskStatus(
              taskResponse.task_id,
              (progress, _status) => {
                // Update assistant message progress
                setChatMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, progress, content: `生成中... ${progress}%` }
                    : msg
                ))
              }
            )

            if (finalImageTask.status === 'completed' && finalImageTask.result_url) {
              resultUrl = finalImageTask.result_url
              // Mirror the backend-persisted parameters so refilling a fresh bubble
              // behaves identically to refilling one rebuilt from /history after reload.
              const refillParams = {
                ...modelConfig,
                generation_mode: imageSubType,
                reference_image_id: imageSubType === 'image-to-image' ? (uploadedImages[0]?.fileId || null) : null,
              }
              // Update assistant message with result
              setChatMessages(prev => prev.map(msg =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      content: '图像生成成功！',
                      imageUrl: resultUrl!,
                      status: 'completed',
                      task_id: finalImageTask.task_id,
                      model_id: selectedModelId,
                      parameters: refillParams,
                      prompt: currentPrompt,
                    }
                  : msg
              ))
              // Add to history
              const newHistoryItem = { 
                prompt: currentPrompt, 
                result: { url: resultUrl },
                task_id: finalImageTask.task_id,
                created_at: new Date().toISOString(),
                model_id: selectedModelId,
                parameters: modelConfig
              }
              setHistory(prev => [newHistoryItem, ...prev])
            } else if (finalImageTask.status === 'failed') {
              throw new Error(finalImageTask.error || '生成失败')
            }
          } else {
            const response = await modelService.generateImage({
              prompt: currentPrompt,
              model: selectedModelId,
              ...modelConfig,
            })
            resultUrl = response.url
            setChatMessages(prev => prev.map(msg => 
              msg.id === assistantMessageId 
                ? { ...msg, content: '图像生成成功！', imageUrl: resultUrl!, status: 'completed' }
                : msg
            ))
            setHistory(prev => [{ prompt: currentPrompt, result: response }, ...prev])
          }
          break

        case 'video':
          if (selectedModelId === 'hailuo' || selectedModelId === 'happyhorse') {
            // For text-to-video, no frames required; for image-to-video, include frames
            const frameIds = videoSubType === 'image-to-video' ? {
              first_frame_id: uploadedImages[0]?.fileId || uploadedFileId!,
              second_frame_id: uploadedImages[1]?.fileId,
              third_frame_id: uploadedImages[2]?.fileId,
            } : {}

            taskResponse = await googleService.generateVideo({
              prompt: currentPrompt,
              model_id: selectedModelId,
              aspect_ratio: modelConfig.aspect_ratio || '16:9',
              resolution: modelConfig.resolution || '720p',
              duration: modelConfig.duration || 8,
              generation_mode: videoSubType, // Pass sub-type to backend
              ...frameIds,
            })

            const finalVideoTask = await googleService.pollTaskStatus(
              taskResponse.task_id,
              (progress, _status) => {
                setChatMessages(prev => prev.map(msg => 
                  msg.id === assistantMessageId 
                    ? { ...msg, progress, content: `生成中... ${progress}%` }
                    : msg
                ))
              }
            )

            if (finalVideoTask.status === 'completed' && finalVideoTask.result_url) {
              resultUrl = finalVideoTask.result_url
              // Mirror backend-persisted params so live-bubble refill == history refill.
              const refillParams = {
                ...modelConfig,
                generation_mode: videoSubType,
                first_frame_id: videoSubType === 'image-to-video' ? (uploadedImages[0]?.fileId || uploadedFileId || null) : null,
                second_frame_id: videoSubType === 'image-to-video' ? (uploadedImages[1]?.fileId || null) : null,
                third_frame_id: videoSubType === 'image-to-video' ? (uploadedImages[2]?.fileId || null) : null,
              }
              setChatMessages(prev => prev.map(msg =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      content: '视频生成成功！',
                      videoUrl: resultUrl!,
                      status: 'completed',
                      task_id: finalVideoTask.task_id,
                      model_id: selectedModelId,
                      parameters: refillParams,
                      prompt: currentPrompt,
                    }
                  : msg
              ))
              const newHistoryItem = { 
                prompt: currentPrompt, 
                result: { url: resultUrl },
                task_id: finalVideoTask.task_id,
                created_at: new Date().toISOString(),
                model_id: selectedModelId,
                parameters: modelConfig
              }
              setHistory(prev => [newHistoryItem, ...prev])
            } else if (finalVideoTask.status === 'failed') {
              throw new Error(finalVideoTask.error || '生成失败')
            }
          } else {
            const response = await modelService.generateVideo({
              prompt: currentPrompt,
              model: selectedModelId,
              ...modelConfig,
            })
            resultUrl = response.url
            setChatMessages(prev => prev.map(msg => 
              msg.id === assistantMessageId 
                ? { ...msg, content: '视频生成成功！', videoUrl: resultUrl!, status: 'completed' }
                : msg
            ))
            setHistory(prev => [{ prompt: currentPrompt, result: response }, ...prev])
          }
          break

        default:
          throw new Error('Unsupported category')
      }
      
      await fetchBalance()
      succeeded = true
    } catch (err: any) {
      // Update assistant message with error
      setChatMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? { ...msg, content: `生成失败: ${err.message || '未知错误'}`, status: 'failed' }
          : msg
      ))
      const detail = String(err?.response?.data?.detail || err?.message || '生成失败')
      setError(detail)
      // Insufficient-credit errors refund nothing to fix here, but refresh the
      // balance so the inline 去充值 banner reflects the true remaining amount.
      if (isInsufficientCredit(detail)) fetchBalance()
    } finally {
      setGenerating(false)
      // Clear the box only on success; on failure keep the text so it can be retried.
      if (succeeded) {
        setPrompt('')
      }
    }
  }

  const handleFileSelect = async (file: File) => {
    setError('')

    try {
      const response = await googleService.uploadFirstFrame(file)
      setUploadedFileId(response.file_id)
    } catch (err: any) {
      setError(err.response?.data?.detail || '文件上传失败')
    }
  }

  // Refill the editor from a past generation (a completed assistant bubble). Restores
  // prompt, model, config (aspect_ratio/resolution/duration), sub-type, and — when the
  // history captured client-side upload ids — the reference/frame image previews.
  // Older tasks without *_id refill text params only; the image slots stay empty.
  const applyRefill = (params: any, promptText?: string, modelId?: string) => {
    const p = params || {}
    if (promptText) setPrompt(promptText)

    // Model must belong to the current category (image editor won't hold a video model).
    if (modelId) {
      const inCategory = getModelsByCategory(selectedCategory).some((m) => m.id === modelId)
      if (inCategory) setSelectedModelId(modelId)
    }

    // Restore model options; drop undefined keys so CompactConfigBar keeps its defaults.
    const cfg: Record<string, any> = {}
    if (p.aspect_ratio != null) cfg.aspect_ratio = p.aspect_ratio
    if (p.resolution != null) cfg.resolution = p.resolution
    if (p.duration != null) cfg.duration = p.duration
    if (Object.keys(cfg).length) setModelConfig((prev) => ({ ...prev, ...cfg }))

    // Sub-type from the saved generation_mode.
    const mode = p.generation_mode
    if (selectedCategory === 'image') {
      setImageSubType(mode === 'image-to-image' ? 'image-to-image' : 'text-to-image')
    } else {
      setVideoSubType(mode === 'image-to-video' ? 'image-to-video' : 'text-to-video')
    }

    // Restore reference images from captured file ids → previewable UploadedImage slots.
    const ids: string[] = selectedCategory === 'image'
      ? [p.reference_image_id].filter(Boolean)
      : [p.first_frame_id, p.second_frame_id, p.third_frame_id].filter(Boolean)
    const restored: UploadedImage[] = ids.map((fileId) => ({
      id: `refill-${fileId}`,
      previewUrl: buildUploadPreviewUrl(fileId),
      fileId,
    }))
    setRefillImages(restored)
    setUploadedImages(restored)
    setUploadedFileId(restored[0]?.fileId ?? null)
    // Force the uncontrolled ImageUploader to remount and re-seed from initialImages.
    setUploaderKey((k) => k + 1)

    setError('')
    // Scroll the editor into view (thread may have pushed it off-screen on mobile).
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleFileRemove = () => {
    setUploadedFileId(null)
  }

  // Create showcase items from history or use defaults
  const getShowcaseItems = () => {
    if (history.length > 0) {
      // Use history items as showcase
      return history.slice(0, 6).map((item, index) => ({
        id: item.task_id || `history-${index}`,
        title: item.prompt?.slice(0, 50) || '创作作品',
        subtitle: item.model_id || '精选展示',
        imageUrl: item.result?.url,
        prompt: item.prompt,
        isVideo: selectedCategory === 'video',
        gradient: [
          'from-pink-900/80 to-purple-900/80',
          'from-blue-900/80 to-cyan-900/80',
          'from-orange-900/80 to-red-900/80',
          'from-green-900/80 to-teal-900/80',
          'from-indigo-900/80 to-purple-900/80',
          'from-yellow-900/80 to-orange-900/80',
        ][index % 6]
      }))
    }
    // Return default showcase items (only image and video supported now)
    return DEFAULT_SHOWCASE[selectedCategory as 'image' | 'video'] || DEFAULT_SHOWCASE.image
  }
  
  const showcaseItems = getShowcaseItems()
  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % Math.max(showcaseItems.length, 1))
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + showcaseItems.length) % Math.max(showcaseItems.length, 1))

  // Open a "我的作品" card: preview the media (image/video), or fill the prompt
  // for media-less default showcase cards.
  const openWork = (item: any) => {
    if (item?.imageUrl) {
      const url = googleService.getResultUrl(item.imageUrl)
      if (item.isVideo) {
        setPreviewVideo(url)
      } else {
        setPreviewImage(url)
      }
    } else if (item?.prompt) {
      setPrompt(item.prompt)
    }
  }

  // Reset carousel when category changes
  useEffect(() => {
    setCurrentSlide(0)
  }, [selectedCategory, history.length])

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col bg-[#0d0d0f] min-w-0 overflow-y-auto">
          {/* Top Section: Sub-type Navigation + Input + Config */}
          <div className="bg-[#0d0d0f] px-4 md:px-8 pt-4 md:pt-6">
            {/* Sub-type Navigation Buttons */}
            <div className="flex items-center gap-2 mb-6">
              {selectedCategory === 'video' && (
                <>
                  <button
                    onClick={() => {
                      setVideoSubType('text-to-video')
                      setUploadedImages([])
                      setUploadedFileId(null)
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                      videoSubType === 'text-to-video'
                        ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-400 border border-pink-500/30'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    <Wand2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>文生视频</span>
                  </button>
                  <button
                    onClick={() => setVideoSubType('image-to-video')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                      videoSubType === 'image-to-video'
                        ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-400 border border-pink-500/30'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>图生视频</span>
                  </button>
                </>
              )}
              {selectedCategory === 'image' && (
                <>
                  <button
                    onClick={() => {
                      setImageSubType('text-to-image')
                      setUploadedImages([])
                      setUploadedFileId(null)
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                      imageSubType === 'text-to-image'
                        ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-400 border border-pink-500/30'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    <Wand2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>文生图</span>
                  </button>
                  <button
                    onClick={() => setImageSubType('image-to-image')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                      imageSubType === 'image-to-image'
                        ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-400 border border-pink-500/30'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>图生图</span>
                  </button>
                </>
              )}
            </div>

            {/* Large Input Area - Pollo.ai Style */}
            <div className="input-large mb-4">
              <div className="flex gap-4">
                {/* Image Uploader - Show for image-to-video and image-to-image modes */}
                {(selectedCategory === 'video' && videoSubType === 'image-to-video') ? (
                  <ImageUploader
                    key={`video-uploader-${uploaderKey}`}
                    initialImages={refillImages}
                    onImagesChange={(images) => {
                      setUploadedImages(images)
                      // Also update legacy state for backwards compatibility
                      if (images.length > 0 && images[0].fileId) {
                        setUploadedFileId(images[0].fileId)
                      } else {
                        setUploadedFileId(null)
                      }
                    }}
                    onUpload={async (file, index) => {
                      const response = await googleService.uploadFirstFrame(file)
                      return response.file_id
                    }}
                    disabled={generating}
                    maxImages={3}
                    mode="video"
                  />
                ) : (selectedCategory === 'image' && imageSubType === 'image-to-image') ? (
                  <ImageUploader
                    key={`image-uploader-${uploaderKey}`}
                    initialImages={refillImages}
                    onImagesChange={(images) => {
                      setUploadedImages(images)
                      if (images.length > 0 && images[0].fileId) {
                        setUploadedFileId(images[0].fileId)
                      } else {
                        setUploadedFileId(null)
                      }
                    }}
                    onUpload={async (file, index) => {
                      const response = await googleService.uploadFirstFrame(file)
                      return response.file_id
                    }}
                    disabled={generating}
                    maxImages={1}
                    mode="image"
                  />
                ) : (
                  /* Default icon for text-based generation */
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500/30 to-purple-500/30 flex items-center justify-center flex-shrink-0 border border-pink-500/20">
                    <Sparkles className="w-6 h-6 text-pink-400" />
                  </div>
                )}
                <div className="flex-1">
                  <textarea
                    className="w-full bg-transparent border-none text-gray-100 placeholder:text-gray-500 resize-none focus:outline-none text-base md:text-lg leading-relaxed"
                    placeholder={
                      selectedCategory === 'video'
                        ? (videoSubType === 'text-to-video'
                            ? '描述您想要生成的视频场景...'
                            : videoSubType === 'image-to-video'
                              ? '描述如何将图片转化为视频，添加运动效果...'
                              : '描述视频变换效果...')
                        : (imageSubType === 'text-to-image'
                            ? '描述您想要生成的图像...'
                            : '描述如何基于参考图生成新图像...')
                    }
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={generating}
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleGenerate()
                      }
                    }}
                  />
                </div>
              </div>

              {/* Bottom row: Cost info + Polish + Generate button */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800/50">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500">
                    预计消耗: <span className="text-pink-400 font-medium">{estimatedCost}</span> 积分
                  </span>
                  <span className="text-gray-600">|</span>
                  <span className="text-gray-500">
                    余额: <span className="text-gray-300 font-medium">{Math.round(balance)}</span> 积分
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Polish button */}
                  <button
                    onClick={handlePolish}
                    disabled={!prompt.trim() || isPolishing || generating}
                    title={prompt.trim() ? 'AI一键润色' : '请先输入描述'}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                      !prompt.trim() || isPolishing || generating
                        ? 'border-gray-700 text-gray-600 cursor-not-allowed'
                        : 'border-purple-500/50 text-purple-300 hover:bg-purple-500/10 hover:border-purple-400 hover:text-purple-200'
                    }`}
                  >
                    {isPolishing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    <span>{isPolishing ? '润色中...' : '一键润色'}</span>
                  </button>
                  {/* Generate button */}
                  <button
                    className={`px-6 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${
                      generating || !prompt.trim() || balance < estimatedCost
                        ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:shadow-lg hover:shadow-pink-500/30 hover:scale-[1.02]'
                    }`}
                    onClick={handleGenerate}
                    disabled={generating || !prompt.trim() || balance < estimatedCost}
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>生成中...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        <span>开始生成</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {error && <CreditErrorBanner message={error} className="mt-4" />}
            </div>

            {/* Config Bar */}
            <div className="bg-[#16161a] rounded-xl border border-gray-800/50 p-3 mb-4 hover:border-gray-700 transition-colors">
              <CompactConfigBar
                category={selectedCategory}
                selectedModelId={selectedModelId}
                onModelChange={setSelectedModelId}
                config={modelConfig}
                onConfigChange={setModelConfig}
                disabled={generating}
              />
            </div>

            {/* Quick Prompts - Dynamic */}
            <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
              <span className="text-xs text-gray-500 mr-1 flex-shrink-0">快速提示:</span>
              {quickPrompts.map((item, index) => (
                <button
                  key={`${item.label}-${index}`}
                  className="quick-prompt-tag"
                  onClick={() => setPrompt(item.prompt)}
                >
                  <span>{item.icon}</span> {item.label}
                </button>
              ))}
              <button
                onClick={handleRefreshPrompts}
                disabled={isRefreshingPrompts}
                className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white transition-all disabled:opacity-50"
                title="换一批"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshingPrompts ? 'animate-spin' : ''}`} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Showcase Carousel - Using History */}
          <div className="flex-1 px-4 md:px-8 pb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-pink-400" strokeWidth={1.5} />
                {history.length > 0 ? '我的作品' : '精选展示'}
              </h3>
              {history.length > 0 && (
                <button
                  onClick={() => navigate('/gallery')}
                  className="text-xs text-pink-400 hover:text-pink-300 transition-colors"
                >
                  查看全部 ({history.length})
                </button>
              )}
            </div>
            <div className="relative h-full min-h-[220px] md:min-h-[360px]">
              {showcaseItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 bg-[#16161a]/50 rounded-2xl border border-gray-800/30">
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-br from-pink-500/10 to-purple-500/10 flex items-center justify-center mb-3 md:mb-4 border border-pink-500/20">
                    {selectedCategory === 'image' ? (
                      <ImageIcon className="w-8 h-8 md:w-10 md:h-10 text-pink-500/50" strokeWidth={1} />
                    ) : (
                      <Video className="w-8 h-8 md:w-10 md:h-10 text-pink-500/50" strokeWidth={1} />
                    )}
                  </div>
                  <p className="text-base md:text-lg font-medium text-gray-300">开始AI创作</p>
                  <p className="text-xs md:text-sm mt-2 text-gray-500">在上方输入描述，开启您的创意之旅</p>
                </div>
              ) : (
                <>
                  {/* Mobile: Single card swipe view */}
                  <div className="md:hidden relative h-[220px] overflow-hidden rounded-2xl">
                    {showcaseItems.map((item: any, index: number) => {
                      const isActive = index === currentSlide
                      const hasMedia = item.imageUrl

                      return (
                        <div
                          key={item.id}
                          className={`absolute inset-0 transition-all duration-300 ease-out ${
                            isActive
                              ? 'opacity-100 translate-x-0'
                              : index < currentSlide
                                ? 'opacity-0 -translate-x-full'
                                : 'opacity-0 translate-x-full'
                          }`}
                          onClick={() => openWork(item)}
                        >
                          <div className="absolute inset-0 rounded-2xl overflow-hidden group border border-gray-800/50">
                            {hasMedia ? (
                              item.isVideo ? (
                                <video
                                  src={googleService.getResultUrl(item.imageUrl)}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  muted
                                  loop
                                  playsInline
                                  preload="metadata"
                                  onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                                  onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
                                />
                              ) : (
                                <img
                                  src={googleService.getResultUrl(item.imageUrl)}
                                  alt={item.title}
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              )
                            ) : (
                              <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient || 'from-pink-900/80 to-purple-900/80'}`} />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                            {item.isVideo && (
                              <div className="absolute top-3 right-3 bg-pink-500/80 backdrop-blur-sm rounded-full p-2 pointer-events-none">
                                <Play className="w-4 h-4 text-white" fill="white" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 p-4">
                              <h3 className="text-base font-bold text-white mb-1 line-clamp-2">{item.title}</h3>
                              <p className="text-xs text-gray-300/80 line-clamp-1">{item.subtitle}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {/* Mobile Navigation Arrows */}
                    {showcaseItems.length > 1 && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); prevSlide() }}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 active:bg-pink-500/80 rounded-full flex items-center justify-center text-white z-10 border border-white/10"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); nextSlide() }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/60 active:bg-pink-500/80 rounded-full flex items-center justify-center text-white z-10 border border-white/10"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </>
                    )}

                    {/* Mobile Dots */}
                    {showcaseItems.length > 1 && (
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/40 backdrop-blur-sm px-2 py-1.5 rounded-full">
                        {showcaseItems.map((_: any, index: number) => (
                          <button
                            key={index}
                            onClick={() => setCurrentSlide(index)}
                            className={`h-1.5 rounded-full transition-all ${
                              index === currentSlide
                                ? 'bg-gradient-to-r from-pink-500 to-purple-500 w-4'
                                : 'bg-white/40 w-1.5'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Desktop: Multi-card carousel view */}
                  <div className="hidden md:flex gap-4 h-[360px]">
                    {showcaseItems.map((item: any, index: number) => {
                      const isActive = index === currentSlide
                      const isPrev = index === (currentSlide - 1 + showcaseItems.length) % showcaseItems.length
                      const isNext = index === (currentSlide + 1) % showcaseItems.length
                      const hasMedia = item.imageUrl

                      return (
                        <div
                          key={item.id}
                          className={`carousel-card ${
                            isActive
                              ? 'flex-[2] opacity-100'
                              : isPrev || isNext
                                ? 'flex-1 opacity-60 hover:opacity-80'
                                : 'flex-0 w-0 opacity-0'
                          }`}
                          style={{ overflow: 'visible' }}
                          onClick={() => {
                            if (index !== currentSlide) {
                              setCurrentSlide(index)
                            } else {
                              openWork(item)
                            }
                          }}
                        >
                          <div className="absolute inset-0 rounded-2xl overflow-hidden group border border-gray-800/50 hover:border-pink-500/30 transition-colors">
                            {hasMedia ? (
                              item.isVideo ? (
                                <video
                                  src={googleService.getResultUrl(item.imageUrl)}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  muted
                                  loop
                                  playsInline
                                  preload="metadata"
                                  onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                                  onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
                                />
                              ) : (
                                <img
                                  src={googleService.getResultUrl(item.imageUrl)}
                                  alt={item.title}
                                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                />
                              )
                            ) : (
                              <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient || 'from-pink-900/80 to-purple-900/80'}`} />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                            {item.isVideo && isActive && (
                              <div className="absolute top-4 right-4 bg-pink-500/80 backdrop-blur-sm rounded-full p-2.5 pointer-events-none z-10">
                                <Play className="w-5 h-5 text-white" fill="white" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 p-6 z-20">
                              <h3 className="text-xl font-bold text-white mb-2 line-clamp-2">{item.title}</h3>
                              <p className="text-sm text-gray-300/80 line-clamp-1">{item.subtitle}</p>
                            </div>
                            <div className="absolute inset-0 bg-gradient-to-t from-pink-500/0 to-pink-500/0 group-hover:from-pink-500/10 group-hover:to-purple-500/5 transition-all pointer-events-none" />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Desktop Navigation Arrows */}
                  {showcaseItems.length > 1 && (
                    <div className="hidden md:block">
                      <button
                        onClick={(e) => { e.stopPropagation(); prevSlide() }}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/60 hover:bg-pink-500/80 rounded-full flex items-center justify-center text-white transition-all z-10 border border-white/10 hover:border-pink-500"
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); nextSlide() }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/60 hover:bg-pink-500/80 rounded-full flex items-center justify-center text-white transition-all z-10 border border-white/10 hover:border-pink-500"
                      >
                        <ChevronRight className="w-6 h-6" />
                      </button>
                    </div>
                  )}

                  {/* Desktop Dots Indicator */}
                  {showcaseItems.length > 1 && (
                    <div className="hidden md:flex absolute bottom-4 left-1/2 -translate-x-1/2 gap-2 bg-black/40 backdrop-blur-sm px-3 py-2 rounded-full">
                      {showcaseItems.map((_: any, index: number) => (
                        <button
                          key={index}
                          onClick={() => setCurrentSlide(index)}
                          className={`h-2 rounded-full transition-all ${
                            index === currentSlide
                              ? 'bg-gradient-to-r from-pink-500 to-purple-500 w-6'
                              : 'bg-white/40 hover:bg-white/60 w-2'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Generation Results (shown when there are messages) */}
          {chatMessages.length > 0 && (
            <div className="border-t border-gray-800/50 bg-[#16161a] p-4 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                  <Palette className="w-5 h-5 text-pink-400" strokeWidth={1.5} />
                  生成结果
                </h3>
                <button
                  onClick={() => setChatMessages([])}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  清空
                </button>
              </div>
              <div 
                ref={chatContainerRef}
                className="space-y-3 max-h-[300px] overflow-y-auto"
              >
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3 md:px-4 py-2 md:py-3 ${
                        msg.type === 'user'
                          ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white'
                          : 'bg-[#1a1a1f] border border-gray-800/50 shadow-sm'
                      }`}
                    >
                      <p className={`text-sm ${msg.type === 'user' ? 'text-white' : 'text-gray-300'}`}>
                        {msg.content}
                      </p>
                      
                      {/* Progress bar for generating */}
                      {msg.status === 'generating' && (
                        <div className="mt-3">
                          <div className="w-full bg-gray-800 rounded-full h-1.5">
                            <div
                              className="bg-gradient-to-r from-pink-500 to-purple-500 h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${msg.progress || 0}%` }}
                            ></div>
                          </div>
                          <div className="flex items-center mt-2 text-xs text-gray-500">
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            生成中...
                          </div>
                        </div>
                      )}
                      
                      {/* Image result */}
                      {msg.imageUrl && msg.status === 'completed' && (
                        <div className="mt-2 md:mt-3">
                          <div 
                            className="relative cursor-pointer group"
                            onClick={() => setPreviewImage(googleService.getResultUrl(msg.imageUrl!))}
                          >
                            <img
                              src={googleService.getResultUrl(msg.imageUrl)}
                              alt="Generated"
                              className="max-w-[200px] max-h-[200px] object-cover rounded-lg shadow-sm border border-gray-800/50"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all rounded-lg"></div>
                          </div>
                          <a
                            href={googleService.getResultUrl(msg.imageUrl)}
                            download
                            className="inline-flex items-center mt-2 text-xs text-pink-400 hover:text-pink-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Download className="w-3 h-3 mr-1" />
                            下载
                          </a>
                        </div>
                      )}
                      
                      {/* Video result */}
                      {msg.videoUrl && msg.status === 'completed' && (
                        <div className="mt-2 md:mt-3">
                          <video
                            src={googleService.getResultUrl(msg.videoUrl)}
                            controls
                            className="max-w-[300px] rounded-lg shadow-sm border border-gray-800/50"
                          />
                          <a
                            href={googleService.getResultUrl(msg.videoUrl)}
                            download
                            className="inline-flex items-center mt-2 text-xs text-pink-400 hover:text-pink-300"
                          >
                            <Download className="w-3 h-3 mr-1" />
                            下载
                          </a>
                        </div>
                      )}
                      
                      {/* Status indicators */}
                      {msg.status === 'completed' && msg.type === 'assistant' && (
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center text-xs text-green-400">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            已完成
                          </div>
                          {/* Refill: restore this generation's prompt/model/params/images into the editor */}
                          <button
                            onClick={() => applyRefill(msg.parameters, msg.prompt ?? msg.content, msg.model_id)}
                            title="复用参数：把这次生成的提示词与设置回填到编辑区"
                            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-pink-300 transition-colors"
                          >
                            <RefreshCw className="w-3 h-3" />
                            复用参数
                          </button>
                        </div>
                      )}
                      
                      {msg.status === 'failed' && (
                        <div className="flex items-center mt-2 text-xs text-red-400">
                          <XCircle className="w-3 h-3 mr-1" />
                          失败
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <button
              className="absolute -top-10 right-0 text-gray-300 hover:text-white transition-colors"
              onClick={() => setPreviewImage(null)}
            >
              <X className="w-8 h-8" />
            </button>
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-lg border border-gray-800/50"
            />
            <a
              href={previewImage}
              download
              className="absolute bottom-4 right-4 bg-[#1a1a1f] hover:bg-[#252530] text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 transition-all border border-gray-700/50"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="w-4 h-4" />
              下载
            </a>
          </div>
        </div>
      )}

      {/* Video Preview Modal */}
      {previewVideo && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewVideo(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <button
              className="absolute -top-10 right-0 text-gray-300 hover:text-white transition-colors"
              onClick={() => setPreviewVideo(null)}
            >
              <X className="w-8 h-8" />
            </button>
            <video
              src={previewVideo}
              controls
              autoPlay
              loop
              playsInline
              className="max-w-full max-h-[85vh] object-contain rounded-lg border border-gray-800/50 bg-black"
              onClick={(e) => e.stopPropagation()}
            />
            <a
              href={previewVideo}
              download
              className="absolute bottom-4 right-4 bg-[#1a1a1f] hover:bg-[#252530] text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 transition-all border border-gray-700/50"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="w-4 h-4" />
              下载
            </a>
          </div>
        </div>
      )}


    </div>
  )
}
