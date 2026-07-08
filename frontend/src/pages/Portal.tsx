import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  Play,
  ImageIcon,
  Video,
  ChevronDown,
  Send,
  Zap,
  Wand2,
  ArrowRight,
  Star,
  Users,
  Clock,
  Rocket,
  Menu,
  X,
  RefreshCw,
  Tv2,
  BookOpen,
  Layers,
  Palette,
  Film,
  Clapperboard,
  Sparkles,
  PersonStanding,
  Scissors,
  Bot,
} from 'lucide-react'
import { getQuickPrompts, QuickPrompt } from '../services/prompt.service'
import { SHOWCASE_ROW1, SHOWCASE_ROW2, ShowcaseItem } from '../data/showcase'
import ProviderLogo from '../components/model/ProviderLogo'

// Background images for the hero carousel (served via backend static endpoint)
const BACKGROUND_IMAGES = [
  '/api/v1/static/a9fdf0aed2dd.jpg',
  '/api/v1/static/a831edea1bf5.jpg',
  '/api/v1/static/7aa8272b7772.jpg',
]

// AI Video models
const VIDEO_MODELS = [
  { id: 'happyhorse', name: 'HappyHorse 1.0', provider: 'HappyHorse', description: '文生视频 / 图生视频', enabled: true, isNew: true },
  { id: 'seedance', name: 'Seedance', provider: 'Seedance', description: '短剧视频合成', enabled: true, isNew: true },
  { id: 'hailuo', name: '海螺 Hailuo 2.3', provider: 'Hailuo', description: '文生 / 图生视频（即将上线）', enabled: false, isNew: false },
]

// AI Image models
const IMAGE_MODELS = [
  { id: 'wan2.7-image', name: 'Wan 2.7 图像', provider: 'Wan', description: '文生图 / 图生图', enabled: true, isNew: true },
  { id: 'wan2.7-image-pro', name: 'Wan 2.7 Pro', provider: 'Wan', description: '更强细节与指令遵循', enabled: true, isNew: true },
]

// “更多AI创作工具” 网格：智能体 + Media Studio 功能（与 Sidebar/App 路由一致）
const MORE_TOOLS = [
  { to: '/agent-studio', icon: Bot, title: '智能体工作室', desc: '自定义 AI 智能体，编排技能与插件全自动执行任务', badge: 'New', iconBg: 'bg-cyan-500/15', iconColor: 'text-cyan-400' },
  { to: '/short-video', icon: Film, title: 'AI短视频', desc: '一句话或一张图，快速生成竖屏短视频', iconBg: 'bg-rose-500/15', iconColor: 'text-rose-400' },
  { to: '/video-to-video', icon: Clapperboard, title: '视频生成视频', desc: '以参考视频驱动，风格化重绘生成新视频', iconBg: 'bg-amber-500/15', iconColor: 'text-amber-400' },
  { to: '/ai-effects', icon: Sparkles, title: 'AI特效', desc: '挤压/融化/亲吻等趣味图像与视频特效', iconBg: 'bg-fuchsia-500/15', iconColor: 'text-fuchsia-400' },
  { to: '/motion-imitation', icon: PersonStanding, title: '动作模仿', desc: '参考图 + 参考动作视频，驱动角色复现动作', iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-400' },
  { to: '/video-edit', icon: Scissors, title: '视频编辑', desc: '基于输入视频的智能编辑与二次创作', iconBg: 'bg-blue-500/15', iconColor: 'text-blue-400' },
]

// AI短剧题材卡片数据
const DRAMA_GENRES = [
  { label: '霸道总裁', emoji: '💼', tags: ['都市', '爱情'], imgUrl: '/api/v1/static/a56928bbfcdf.jpg', tint: 'from-slate-900/60' },
  { label: '古装爱情', emoji: '🏮', tags: ['古风', '宫廷'], imgUrl: '/api/v1/static/20bdc9ea4627.jpg', tint: 'from-pink-900/60' },
  { label: '都市悬疑', emoji: '🔍', tags: ['悬疑', '犯罪'], imgUrl: '/api/v1/static/550d5497443f.jpg', tint: 'from-blue-900/70' },
  { label: '穿越奇缘', emoji: '✨', tags: ['穿越', '奇幻'], imgUrl: '/api/v1/static/632a047ae4f6.jpg', tint: 'from-cyan-900/60' },
  { label: '豪门恩怨', emoji: '💎', tags: ['豪门', '复仇'], imgUrl: '/api/v1/static/a9fdf0aed2dd.jpg', tint: 'from-rose-900/60' },
  { label: '修仙玄幻', emoji: '⚔️', tags: ['玄幻', '修仙'], imgUrl: '/api/v1/static/7aa8272b7772.jpg', tint: 'from-emerald-900/60' },
  { label: '青春校园', emoji: '📚', tags: ['校园', '青春'], imgUrl: '/api/v1/static/ff6979313e19.jpg', tint: 'from-green-900/50' },
  { label: '末日求生', emoji: '🌪️', tags: ['末日', '动作'], imgUrl: '/api/v1/static/bec01d041772.jpg', tint: 'from-gray-900/70' },
  { label: '复仇归来', emoji: '🔥', tags: ['复仇', '逆袭'], imgUrl: '/api/v1/static/1d15f2bbb8e9.jpg', tint: 'from-orange-900/60' },
]

// Fallback prompts (used while loading or when API unavailable)
const FALLBACK_PROMPTS: QuickPrompt[] = [
  { icon: '🌃', label: '霓虹城市', prompt: '赛博朋克风格的霓虹灯城市夜景，雨天倒影' },
  { icon: '🎨', label: '抽象艺术', prompt: '流动的色彩交织，蓝色和金色为主调的抽象画作' },
  { icon: '🏔️', label: '自然风光', prompt: '壮丽的山脉日出，云海翻涌，金色阳光' },
  { icon: '🚀', label: '科幻场景', prompt: '未来太空站，星际飞船停靠，地球背景' },
]

function ShowcaseCard({ item, size = 'md' }: { item: ShowcaseItem; size?: 'sm' | 'md' }) {
  const dims = size === 'sm'
    ? 'w-[220px] h-[148px]'
    : 'w-[300px] h-[200px]'
  return (
    <div className={`relative flex-shrink-0 ${dims} rounded-xl overflow-hidden group cursor-pointer showcase-card`}>
      {item.type === 'video' ? (
        <video
          src={item.url}
          muted loop playsInline preload="metadata"
          onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
      ) : (
        <img
          src={item.url}
          alt={item.label}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
      )}
      {/* Dark overlay on hover */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300" />
      {/* Type badge */}
      <div className="absolute top-2 left-2">
        <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-sm ${
          item.type === 'video' ? 'bg-purple-500/80 text-white' : 'bg-pink-500/80 text-white'
        }`}>
          {item.type === 'video' ? '视频' : '图片'}
        </span>
      </div>
      {/* Bottom info — slides up on hover */}
      <div className="absolute bottom-0 left-0 right-0 p-2.5 translate-y-full group-hover:translate-y-0 transition-transform duration-300 bg-gradient-to-t from-black/80 to-transparent pt-6">
        <p className="text-white text-xs font-medium truncate">{item.label}</p>
        <p className="text-gray-300 text-[10px] mt-0.5 opacity-80">{item.model}</p>
      </div>
    </div>
  )
}

export default function Portal() {
  const navigate = useNavigate()
  useDocumentTitle('首页')

  const [currentBgIndex, setCurrentBgIndex] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<'video' | 'image'>('video')
  const [showVideoMenu, setShowVideoMenu] = useState(false)
  const [showImageMenu, setShowImageMenu] = useState(false)
  const [showToolsMenu, setShowToolsMenu] = useState(false)
  const [selectedModel, setSelectedModel] = useState(VIDEO_MODELS[0])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>(FALLBACK_PROMPTS)
  const [isRefreshingPrompts, setIsRefreshingPrompts] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Background carousel effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentBgIndex((prev) => (prev + 1) % BACKGROUND_IMAGES.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  // Load dynamic quick prompts on mount and category change
  useEffect(() => {
    let cancelled = false
    getQuickPrompts(selectedCategory).then((prompts) => {
      if (!cancelled) setQuickPrompts(prompts)
    }).catch(() => {
      // Keep current prompts on error
    })
    return () => { cancelled = true }
  }, [selectedCategory])

  const handleRefreshPrompts = async () => {
    if (isRefreshingPrompts) return
    setIsRefreshingPrompts(true)
    try {
      const prompts = await getQuickPrompts(selectedCategory, true)
      setQuickPrompts(prompts)
    } catch {
      // Keep current prompts on error
    } finally {
      setIsRefreshingPrompts(false)
    }
  }

  const handleLogin = () => {
    navigate('/login')
  }

  const handleStartFree = () => {
    navigate('/register')
  }

  const handleSubmit = () => {
    // Redirect to login when trying to create
    navigate('/login')
  }

  const handleCategoryChange = (category: 'video' | 'image') => {
    setSelectedCategory(category)
    if (category === 'video') {
      setSelectedModel(VIDEO_MODELS.find(m => m.enabled) || VIDEO_MODELS[0])
    } else {
      setSelectedModel(IMAGE_MODELS.find(m => m.enabled) || IMAGE_MODELS[0])
    }
  }

  const currentModels = selectedCategory === 'video' ? VIDEO_MODELS : IMAGE_MODELS

  return (
    <div className="min-h-screen bg-[#0a0a0c] relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0">
        {/* Background Images with crossfade */}
        {BACKGROUND_IMAGES.map((img, index) => (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-2000 ${
              index === currentBgIndex ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <img
              src={img}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        ))}
        {/* Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50" />
      </div>

      {/* Navigation Bar */}
      <nav className="relative z-50 flex items-center justify-between px-4 md:px-12 py-3 md:py-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 md:w-9 md:h-9 bg-gradient-to-br from-pink-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-pink-500/20">
            <Rocket className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={1.5} />
          </div>
          <span className="text-lg md:text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">AI智汇平台</span>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          {mobileMenuOpen ? (
            <X className="w-6 h-6 text-gray-300" />
          ) : (
            <Menu className="w-6 h-6 text-gray-300" />
          )}
        </button>

        {/* Navigation - Desktop (Right aligned) */}
        <div className="hidden md:flex items-center gap-1 ml-auto mr-4">
          {/* AI图片 Dropdown */}
          <div
            className="relative"
            onMouseEnter={() => setShowImageMenu(true)}
            onMouseLeave={() => setShowImageMenu(false)}
          >
            <button className="px-4 py-2 text-gray-300 hover:text-white transition-colors rounded-lg hover:bg-white/10 flex items-center gap-1">
              AI图片
              <ChevronDown className="w-4 h-4" />
            </button>

            {/* Image Dropdown Menu */}
            {showImageMenu && (
              <div className="absolute top-full right-0 pt-2 w-[500px]">
                <div className="bg-[#1a1a1f]/95 backdrop-blur-xl rounded-2xl border border-gray-800/50 shadow-2xl p-6 animate-fadeIn">
                <div className="grid grid-cols-2 gap-6">
                  {/* 文生图 */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <Wand2 className="w-4 h-4 text-blue-400" />
                      </div>
                      <span className="font-medium text-white">文生图</span>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">通过文字描述生成图像</p>

                    <div className="space-y-2">
                      {IMAGE_MODELS.map(model => (
                        <button
                          key={model.id}
                          onClick={handleLogin}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                        >
                          <div className="flex items-center gap-2">
                            <ProviderLogo provider={model.provider || model.id} size={18} />
                            <span className="text-sm text-gray-300 group-hover:text-white">{model.name}</span>
                            {model.isNew && (
                              <span className="px-1.5 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] rounded">New</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 图生图 */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-pink-500/20 rounded-lg flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-pink-400" />
                      </div>
                      <span className="font-medium text-white">图生图</span>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">基于参考图像生成新图像</p>

                    <div className="space-y-2">
                      <button
                        onClick={handleLogin}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-300 group-hover:text-white">Wan 2.7 图像</span>
                          <span className="px-1.5 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] rounded">New</span>
                        </div>
                      </button>
                      <button
                        onClick={handleLogin}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-300 group-hover:text-white">Wan 2.7 Pro</span>
                          <span className="px-1.5 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] rounded">New</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Supported Models */}
                <div className="mt-6 pt-4 border-t border-gray-800/50">
                  <p className="text-xs text-gray-500 mb-2">支持的图像模型</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-pink-500/20 rounded text-xs text-pink-400">Wan 2.7 图像</span>
                    <span className="px-2 py-1 bg-pink-500/20 rounded text-xs text-pink-400">Wan 2.7 Pro</span>
                  </div>
                </div>
                </div>
              </div>
            )}
          </div>

          {/* AI视频 Dropdown */}
          <div
            className="relative"
            onMouseEnter={() => setShowVideoMenu(true)}
            onMouseLeave={() => setShowVideoMenu(false)}
          >
            <button className="px-4 py-2 text-gray-300 hover:text-white transition-colors rounded-lg hover:bg-white/10 flex items-center gap-1">
              AI视频
              <ChevronDown className="w-4 h-4" />
            </button>

            {/* Video Dropdown Menu */}
            {showVideoMenu && (
              <div className="absolute top-full right-0 pt-2 w-[700px]">
                <div className="bg-[#1a1a1f]/95 backdrop-blur-xl rounded-2xl border border-gray-800/50 shadow-2xl p-6 animate-fadeIn">
                <div className="grid grid-cols-3 gap-6">
                  {/* 文生视频 */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center">
                        <Wand2 className="w-4 h-4 text-purple-400" />
                      </div>
                      <span className="font-medium text-white">文生视频</span>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">通过文字描述生成视频</p>

                    <div className="space-y-2">
                      {VIDEO_MODELS.filter(m => m.enabled).map(model => (
                        <button
                          key={model.id}
                          onClick={handleLogin}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                        >
                          <div className="flex items-center gap-2">
                            <ProviderLogo provider={model.provider || model.id} size={18} />
                            <span className="text-sm text-gray-300 group-hover:text-white">{model.name}</span>
                            {model.isNew && (
                              <span className="px-1.5 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] rounded">New</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 图生视频 */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-pink-500/20 rounded-lg flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-pink-400" />
                      </div>
                      <span className="font-medium text-white">图生视频</span>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">将静态图像转化为动态视频</p>

                    <div className="space-y-2">
                      {VIDEO_MODELS.filter(m => m.enabled).map(model => (
                        <button
                          key={model.id}
                          onClick={handleLogin}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                        >
                          <div className="flex items-center gap-2">
                            <ProviderLogo provider={model.provider || model.id} size={18} />
                            <span className="text-sm text-gray-300 group-hover:text-white">{model.name}</span>
                            {model.isNew && (
                              <span className="px-1.5 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] rounded">New</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                </div>

                {/* Supported Models */}
                <div className="mt-6 pt-4 border-t border-gray-800/50">
                  <p className="text-xs text-gray-500 mb-2">支持的视频模型</p>
                  <div className="flex flex-wrap gap-2">
                    {['HappyHorse 1.0', 'Seedance', '海螺 Hailuo 2.3 (即将上线)'].map(name => (
                      <span key={name} className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400">{name}</span>
                    ))}
                  </div>
                </div>
                </div>
              </div>
            )}
          </div>

          {/* AI工具 Dropdown */}
          <div
            className="relative"
            onMouseEnter={() => setShowToolsMenu(true)}
            onMouseLeave={() => setShowToolsMenu(false)}
          >
            <button className="px-4 py-2 text-gray-300 hover:text-white transition-colors rounded-lg hover:bg-white/10 flex items-center gap-1">
              AI工具
              <ChevronDown className="w-4 h-4" />
            </button>

            {showToolsMenu && (
              <div className="absolute top-full right-0 pt-2 w-[520px]">
                <div className="bg-[#1a1a1f]/95 backdrop-blur-xl rounded-2xl border border-gray-800/50 shadow-2xl p-6 animate-fadeIn">
                    {/* AI短剧 */}
                    <button
                      onClick={() => navigate('/drama')}
                      className="flex items-start gap-3 p-3 rounded-xl hover:bg-purple-500/10 transition-colors text-left group col-span-2 border border-purple-500/20 hover:border-purple-400/40"
                    >
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-500/30 to-pink-500/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                        <Tv2 className="w-5 h-5 text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white text-sm">AI短剧生成</span>
                          <span className="px-1.5 py-0.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold rounded">NEW</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">输入概念→大纲→分镜→图像→视频，全自动四步生成爆款短剧</p>
                        <div className="flex gap-1 mt-1.5">
                          {['DeepSeek V4', 'Wan 2.7', 'Seedance'].map(m => (
                            <span key={m} className="text-[9px] px-1.5 py-0.5 bg-purple-500/15 text-purple-400 rounded-full">{m}</span>
                          ))}
                        </div>
                      </div>
                    </button>

                  <div className="mt-4 pt-4 border-t border-gray-800/50">
                    <p className="text-xs text-gray-500">基于 DeepSeek、Wan 2.7、Seedance 等顶尖模型</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI短剧 - 独立高亮入口 */}
          <button
            onClick={() => navigate('/drama')}
            className="px-4 py-2 flex items-center gap-1.5 text-purple-300 hover:text-white transition-colors rounded-lg hover:bg-purple-500/10 border border-purple-500/30 hover:border-purple-400/60 relative"
          >
            <Tv2 className="w-4 h-4" />
            AI短剧
            <span className="absolute -top-1.5 -right-1 px-1 py-0.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[9px] font-bold rounded leading-none">NEW</span>
          </button>

          <button
            onClick={() => navigate('/pricing')}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors rounded-lg hover:bg-white/10"
          >
            价格
          </button>
        </div>

        {/* Right Actions - Desktop */}
        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={handleLogin}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            登录
          </button>
          <button
            onClick={handleStartFree}
            className="px-5 py-2.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-pink-500/30 transition-all hover:scale-105"
          >
            免费开始
          </button>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/90 backdrop-blur-xl">
          <div className="flex flex-col h-full pt-20 px-6 pb-8">
            {/* Mobile Navigation Links */}
            <div className="flex-1 space-y-2">
              <button
                onClick={() => { handleLogin(); setMobileMenuOpen(false) }}
                className="w-full text-left px-4 py-3 text-lg text-gray-200 hover:bg-white/10 rounded-xl transition-colors flex items-center justify-between"
              >
                <span>AI图片</span>
                <span className="text-xs text-pink-400">Wan 2.7</span>
              </button>
              <button
                onClick={() => { handleLogin(); setMobileMenuOpen(false) }}
                className="w-full text-left px-4 py-3 text-lg text-gray-200 hover:bg-white/10 rounded-xl transition-colors flex items-center justify-between"
              >
                <span>AI视频</span>
                <span className="text-xs text-pink-400">HappyHorse</span>
              </button>
              <div className="border-t border-gray-800/50 my-2" />
              <p className="px-4 py-1 text-xs text-gray-500">AI工具</p>
              <button
                onClick={() => { navigate('/drama'); setMobileMenuOpen(false) }}
                className="w-full text-left px-4 py-3 text-lg text-white hover:bg-purple-500/10 rounded-xl transition-colors flex items-center justify-between border border-purple-500/20"
              >
                <span className="flex items-center gap-2"><Tv2 className="w-5 h-5 text-purple-400" />AI短剧生成</span>
                <span className="px-2 py-0.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold rounded">NEW</span>
              </button>
              <div className="border-t border-gray-800/50 my-2" />
              <button
                onClick={() => { navigate('/pricing'); setMobileMenuOpen(false) }}
                className="w-full text-left px-4 py-3 text-lg text-gray-200 hover:bg-white/10 rounded-xl transition-colors"
              >
                价格
              </button>
            </div>

            {/* Mobile Auth Buttons */}
            <div className="space-y-3 pt-6 border-t border-gray-800">
              <button
                onClick={() => { handleLogin(); setMobileMenuOpen(false) }}
                className="w-full py-3 text-gray-200 border border-gray-700 rounded-xl hover:bg-white/10 transition-colors"
              >
                登录
              </button>
              <button
                onClick={() => { handleStartFree(); setMobileMenuOpen(false) }}
                className="w-full py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-medium rounded-xl"
              >
                免费开始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hero Text ────────────────────────────────────────────────── */}
      <div className="relative z-10 pt-10 pb-2 flex flex-col items-center px-4">
        <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white text-center mb-3 tracking-tight leading-tight">
          您的一站式
          <span className="bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 bg-clip-text text-transparent inline"> AI图片、视频与短剧</span>
          {' '}创作平台
        </h1>
        <p className="text-sm md:text-lg text-gray-400 text-center max-w-2xl px-2">
          汇聚全球顶尖AI模型，一键生成专业级图片、视频和短剧内容
        </p>
      </div>

      {/* ── Hero Showcase ────────────────────────────────────────────── */}
      <div className="relative z-10 pt-6 pb-4">
        {/* Label */}
        <p className="text-center text-[11px] text-pink-400/90 uppercase tracking-[0.2em] font-semibold mb-5 select-none">
          ✦ AI Gallery &nbsp;·&nbsp; 精选创作展示 ✦
        </p>

        {/* Left / right fade masks */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 md:w-40 bg-gradient-to-r from-[#0a0a0c] to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 md:w-40 bg-gradient-to-l from-[#0a0a0c] to-transparent z-10" />

        {/* Row 1 — left */}
        <div className="overflow-hidden mb-2.5">
          <div className="flex gap-2.5 marquee-left" style={{ width: 'max-content' }}>
            {[...SHOWCASE_ROW1, ...SHOWCASE_ROW1].map((item, i) => (
              <ShowcaseCard key={`r1-${i}`} item={item} />
            ))}
          </div>
        </div>

        {/* Row 2 — right */}
        <div className="overflow-hidden">
          <div className="flex gap-2.5 marquee-right" style={{ width: 'max-content' }}>
            {[...SHOWCASE_ROW2, ...SHOWCASE_ROW2].map((item, i) => (
              <ShowcaseCard key={`r2-${i}`} item={item} />
            ))}
          </div>
        </div>

        {/* Bottom gradient into next section */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0a0a0c] to-transparent z-10" />
      </div>

      {/* Main Content */}
      <main className="relative z-10 flex flex-col items-center px-4 pt-6 pb-8">

        {/* Creation Panel */}
        <div className="w-full max-w-3xl px-2 sm:px-0">
          {/* Input Area */}
          <div className="bg-[#16161a]/80 backdrop-blur-xl rounded-2xl border border-gray-800/50 p-4 md:p-6 shadow-2xl">
            {/* Category Selector - Mobile Optimized */}
            <div className="flex flex-wrap items-center gap-2 md:gap-4 mb-4">
              <button
                onClick={() => handleCategoryChange(selectedCategory === 'video' ? 'image' : 'video')}
                className="flex items-center gap-2 px-3 md:px-4 py-2 bg-pink-500/20 text-pink-400 rounded-xl hover:bg-pink-500/30 transition-colors text-sm md:text-base"
              >
                {selectedCategory === 'video' ? (
                  <>
                    <Video className="w-4 h-4" />
                    <span>AI视频</span>
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-4 h-4" />
                    <span>AI图片</span>
                  </>
                )}
                <ChevronDown className="w-4 h-4" />
              </button>

              {/* Model selector - Truncate on mobile */}
              <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 bg-white/5 rounded-lg max-w-[180px] md:max-w-none">
                <ProviderLogo provider={selectedModel.provider || selectedModel.id} size={18} />
                <span className="text-xs md:text-sm text-gray-400 truncate">{selectedModel.provider}</span>
                <span className="text-xs md:text-sm text-white truncate">{selectedModel.name}</span>
              </div>

              {/* Quick settings - Hidden on mobile */}
              {selectedCategory === 'video' && (
                <div className="hidden md:flex items-center gap-2 text-sm text-gray-400">
                  <span className="px-2 py-1 bg-white/5 rounded">16:9</span>
                  <span className="px-2 py-1 bg-white/5 rounded">5s</span>
                  <span className="px-2 py-1 bg-white/5 rounded">720P</span>
                </div>
              )}
              {selectedCategory === 'image' && (
                <div className="hidden md:flex items-center gap-2 text-sm text-gray-400">
                  <span className="px-2 py-1 bg-white/5 rounded">1:1</span>
                  <span className="px-2 py-1 bg-white/5 rounded">高清</span>
                </div>
              )}
            </div>

            {/* Text Input */}
            <div className="flex flex-col md:flex-row gap-3 md:gap-4">
              <div className="flex-1">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={selectedCategory === 'video' ? '描述您想要生成的视频场景...' : '描述您想要生成的图像...'}
                  className="w-full bg-transparent text-gray-100 placeholder:text-gray-500 resize-none focus:outline-none text-sm md:text-lg leading-relaxed"
                  rows={2}
                />
              </div>
              <button
                onClick={handleSubmit}
                className="self-stretch md:self-end px-4 md:px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-pink-500/30 transition-all hover:scale-105 flex items-center justify-center gap-2"
              >
                <Send className="w-5 h-5" />
                <span>开始创作</span>
              </button>
            </div>
          </div>

          {/* Quick Prompts */}
          <div className="flex items-center gap-2 md:gap-3 mt-4 overflow-x-auto pb-2 scrollbar-hide -mx-2 px-2">
            {quickPrompts.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                onClick={() => setPrompt(item.prompt)}
                className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 bg-white/5 hover:bg-white/10 backdrop-blur rounded-full text-xs md:text-sm text-gray-300 hover:text-white transition-all whitespace-nowrap border border-white/10 hover:border-white/20"
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
            <button
              onClick={handleRefreshPrompts}
              disabled={isRefreshingPrompts}
              className="flex items-center justify-center w-8 h-8 md:w-9 md:h-9 bg-white/5 hover:bg-white/10 backdrop-blur rounded-full text-gray-400 hover:text-white transition-all border border-white/10 hover:border-white/20 flex-shrink-0 disabled:opacity-50"
              title="换一批"
            >
              <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 ${isRefreshingPrompts ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Features Section */}
        <div className="mt-12 md:mt-20 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 max-w-4xl w-full px-2 sm:px-0">
          <div className="bg-white/5 backdrop-blur rounded-xl md:rounded-2xl p-4 md:p-6 border border-white/10 hover:border-pink-500/30 transition-colors group">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-pink-500/20 rounded-xl flex items-center justify-center mb-3 md:mb-4 group-hover:scale-110 transition-transform">
              <Zap className="w-5 h-5 md:w-6 md:h-6 text-pink-400" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-white mb-1 md:mb-2">极速生成</h3>
            <p className="text-xs md:text-sm text-gray-400">秒级响应，快速生成高质量AI内容</p>
          </div>

          <div className="bg-white/5 backdrop-blur rounded-xl md:rounded-2xl p-4 md:p-6 border border-white/10 hover:border-purple-500/30 transition-colors group">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-purple-500/20 rounded-xl flex items-center justify-center mb-3 md:mb-4 group-hover:scale-110 transition-transform">
              <Star className="w-5 h-5 md:w-6 md:h-6 text-purple-400" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-white mb-1 md:mb-2">顶尖模型</h3>
            <p className="text-xs md:text-sm text-gray-400">集成 Wan 2.7、海螺 Hailuo、HappyHorse、Seedance 等顶尖 AI模型</p>
          </div>

          <div className="bg-white/5 backdrop-blur rounded-xl md:rounded-2xl p-4 md:p-6 border border-white/10 hover:border-blue-500/30 transition-colors group">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-500/20 rounded-xl flex items-center justify-center mb-3 md:mb-4 group-hover:scale-110 transition-transform">
              <Users className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
            </div>
            <h3 className="text-base md:text-lg font-semibold text-white mb-1 md:mb-2">简单易用</h3>
            <p className="text-xs md:text-sm text-gray-400">无需专业知识，输入描述即可创作</p>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-10 md:mt-16 flex items-center justify-center gap-6 md:gap-12 text-center">
          <div>
            <div className="text-2xl md:text-3xl font-bold text-white">20+</div>
            <div className="text-xs md:text-sm text-gray-400">AI模型</div>
          </div>
          <div className="w-px h-8 md:h-10 bg-gray-700" />
          <div>
            <div className="text-2xl md:text-3xl font-bold text-white">100K+</div>
            <div className="text-xs md:text-sm text-gray-400">作品生成</div>
          </div>
          <div className="w-px h-8 md:h-10 bg-gray-700" />
          <div>
            <div className="text-2xl md:text-3xl font-bold text-white">99.9%</div>
            <div className="text-xs md:text-sm text-gray-400">服务可用</div>
          </div>
        </div>

        {/* ── AI短剧生成 Spotlight ──────────────────────────────────────── */}
        <div className="mt-16 md:mt-24 w-full max-w-6xl px-2 sm:px-0">
          {/* Section header */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-purple-500/40" />
            <span className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30 rounded-full text-sm text-purple-300 whitespace-nowrap">
              <Tv2 className="w-4 h-4" />
              全新功能上线
            </span>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-purple-500/40" />
          </div>

          {/* Main spotlight card */}
          <div className="relative overflow-hidden rounded-3xl border border-purple-500/20 bg-gradient-to-br from-[#0f0818] via-[#170b2e] to-[#0a0a18]">
            {/* Background glow effects */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-pink-600/8 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-violet-500/5 rounded-full blur-2xl pointer-events-none" />

            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-0">
              {/* Left: Description */}
              <div className="p-8 md:p-12 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-5">
                  <span className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold rounded-full">NEW</span>
                  <span className="text-gray-400 text-sm">AI短剧生成 · 全自动创作流水线</span>
                </div>

                <h2 className="text-2xl md:text-4xl font-bold text-white mb-4 leading-tight">
                  输入一个概念<br />
                  <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">AI全程生成完整短剧</span>
                </h2>

                <p className="text-gray-400 text-sm md:text-base mb-8 leading-relaxed">
                  从故事概念到视频成品，DeepSeek 编剧 + Wan 出图 + Seedance 合成，让每个人都能零门槛创作爆款短剧
                </p>

                {/* Pipeline steps */}
                <div className="space-y-3 mb-8">
                  {[
                    { step: '01', title: '故事创作', desc: 'DeepSeek 生成多集剧本与角色设定', icon: <BookOpen className="w-4 h-4 text-purple-400" />, bg: 'bg-purple-500/20' },
                    { step: '02', title: '分镜规划', desc: 'AI 拆分镜头并生成图像提示词', icon: <Layers className="w-4 h-4 text-pink-400" />, bg: 'bg-pink-500/20' },
                    { step: '03', title: '图像生成', desc: 'Wan 2.7 逐镜渲染高质量画面', icon: <Palette className="w-4 h-4 text-amber-400" />, bg: 'bg-amber-500/20' },
                    { step: '04', title: '视频合成', desc: 'Seedance 将静帧合成动态视频', icon: <Video className="w-4 h-4 text-emerald-400" />, bg: 'bg-emerald-500/20' },
                  ].map(({ step, title, desc, icon, bg }) => (
                    <div key={step} className="flex items-center gap-3 group">
                      <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-gray-600 font-mono">STEP {step}</span>
                          <span className="text-sm font-semibold text-white">{title}</span>
                          <span className="text-xs text-gray-500 truncate hidden sm:block">{desc}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <button
                  onClick={() => navigate('/drama')}
                  className="self-start flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 text-white font-semibold rounded-xl hover:opacity-90 hover:scale-105 transition-all shadow-lg shadow-purple-500/30"
                >
                  <Tv2 className="w-5 h-5" />
                  立即体验短剧生成
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {/* Right: Drama genre cards showcase */}
              <div className="relative overflow-hidden lg:border-l border-purple-500/10 p-6 md:p-8">
                <p className="text-xs text-gray-600 uppercase tracking-widest mb-4 text-center">9 大热门题材 · 一键生成</p>
                <div className="grid grid-cols-3 gap-2.5">
                  {DRAMA_GENRES.map(({ label, emoji, tags, imgUrl, tint }) => (
                    <div
                      key={label}
                      onClick={() => navigate('/drama')}
                      className="relative rounded-xl overflow-hidden cursor-pointer group hover:scale-105 transition-transform duration-300 shadow-lg bg-gray-900"
                      style={{ aspectRatio: '9/16' }}
                    >
                      {/* Background image */}
                      <img
                        src={imgUrl}
                        alt={label}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      />
                      {/* Color tint + dark gradient overlay */}
                      <div className={`absolute inset-0 bg-gradient-to-t ${tint} via-transparent to-transparent opacity-70`} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/10" />
                      {/* top badge */}
                      <div className="absolute top-1.5 right-1.5">
                        <span className="text-[8px] bg-purple-500/80 text-white px-1 py-0.5 rounded font-medium backdrop-blur-sm">AI生成</span>
                      </div>
                      {/* bottom info */}
                      <div className="absolute bottom-0 left-0 right-0 p-2">
                        <p className="text-white text-[10px] font-bold text-center leading-tight mb-1 drop-shadow">{label}</p>
                        <div className="flex flex-wrap gap-0.5 justify-center">
                          {tags.map(t => (
                            <span key={t} className="text-[8px] text-white/70 bg-white/15 backdrop-blur-sm rounded px-1">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom stats bar */}
            <div className="border-t border-purple-500/10 px-6 md:px-12 py-4 flex items-center justify-around flex-wrap gap-4">
              <div className="text-center">
                <div className="text-lg font-bold text-white">4 步</div>
                <div className="text-xs text-gray-500">全自动流水线</div>
              </div>
              <div className="w-px h-8 bg-purple-500/20 hidden sm:block" />
              <div className="text-center">
                <div className="text-lg font-bold text-white">9 种</div>
                <div className="text-xs text-gray-500">热门题材覆盖</div>
              </div>
              <div className="w-px h-8 bg-purple-500/20 hidden sm:block" />
              <div className="text-center">
                <div className="text-base font-bold text-white bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">DeepSeek · Wan · Seedance</div>
                <div className="text-xs text-gray-500">顶尖 AI 联合驱动</div>
              </div>
              <div className="w-px h-8 bg-purple-500/20 hidden md:block" />
              <div className="text-center hidden md:block">
                <div className="text-lg font-bold text-white">多集</div>
                <div className="text-xs text-gray-500">支持连载剧情</div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Tools Showcase */}
        <div className="mt-12 md:mt-20 max-w-5xl w-full px-2 sm:px-0">
          <h2 className="text-xl md:text-2xl font-bold text-white text-center mb-2">
            更多AI创作工具
          </h2>
          <p className="text-sm md:text-base text-gray-400 text-center mb-8 md:mb-10">
            短剧、短视频、AI特效、动作模仿、视频编辑到智能体，集成 DeepSeek、Wan 2.7、Seedance 等顶尖模型
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {/* AI短剧生成 - 跨两列，置顶高亮 */}
            <div
              className="sm:col-span-2 lg:col-span-2 relative overflow-hidden bg-gradient-to-br from-purple-950/60 via-[#12062a]/80 to-pink-950/40 backdrop-blur rounded-xl md:rounded-2xl p-5 md:p-6 border border-purple-500/30 hover:border-purple-400/60 transition-all cursor-pointer group"
              onClick={() => navigate('/omni-weaver')}
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/10 rounded-full blur-2xl pointer-events-none" />
              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-start gap-4 flex-1">
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500/30 to-pink-500/20 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                    <Tv2 className="w-6 h-6 text-purple-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base md:text-lg font-semibold text-white">AI短剧生成</h3>
                      <span className="px-2 py-0.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold rounded">NEW</span>
                    </div>
                    <p className="text-xs md:text-sm text-gray-400 mb-3">输入故事概念，AI全自动生成剧本大纲、分镜脚本、场景图像和视频片段</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['DeepSeek 编剧', 'Wan 出图', 'Seedance 视频', '9大题材', '多集连载'].map(t => (
                        <span key={t} className="px-2 py-0.5 bg-purple-500/15 text-purple-300 text-[10px] rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <button className="self-start sm:self-center flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap flex-shrink-0">
                  立即体验 <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 智能体工作室 + Media Studio 功能卡 */}
            {MORE_TOOLS.map(tool => (
              <div
                key={tool.to}
                onClick={() => navigate(tool.to)}
                className="relative overflow-hidden bg-[#12121a]/80 backdrop-blur rounded-xl md:rounded-2xl p-5 border border-gray-800/60 hover:border-pink-500/40 hover:bg-[#16161f] transition-all cursor-pointer group"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform ${tool.iconBg}`}>
                    <tool.icon className={`w-5 h-5 ${tool.iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm md:text-base font-semibold text-white truncate">{tool.title}</h3>
                      {tool.badge && (
                        <span className="px-1.5 py-0.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white text-[9px] font-bold rounded flex-shrink-0">{tool.badge}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{tool.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-sm text-gray-500 bg-[#080810]">
        <p>© 2024 AI智汇平台. All rights reserved.</p>
      </footer>

      {/* CSS for animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
        .duration-2000 {
          transition-duration: 2000ms;
        }

        @keyframes marquee-left {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes marquee-right {
          from { transform: translateX(-50%); }
          to   { transform: translateX(0); }
        }
        .marquee-left {
          animation: marquee-left 40s linear infinite;
        }
        .marquee-right {
          animation: marquee-right 36s linear infinite;
        }
        .marquee-left2 {
          animation: marquee-left 48s linear infinite;
        }
        .marquee-left:hover,
        .marquee-right:hover,
        .marquee-left2:hover {
          animation-play-state: paused;
        }
        /* pause marquee when any card inside is hovered */
        .showcase-card:hover ~ * {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  )
}
