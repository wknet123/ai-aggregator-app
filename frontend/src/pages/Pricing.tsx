import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  Rocket,
  ImageIcon,
  Video,
  Wand2,
  Check,
  Zap,
  Crown,
  ArrowLeft,
  ChevronDown,
  Bot,
  Film,
  Clapperboard,
  Sparkles,
  PersonStanding,
  Scissors,
} from 'lucide-react'

// Pricing categories
const PRICING_CATEGORIES = [
  { id: 'image', label: 'AI图片', icon: ImageIcon },
  { id: 'video', label: 'AI视频', icon: Video },
  { id: 'features', label: '创作功能', icon: Wand2 },
]

// Image models pricing
const IMAGE_MODELS = [
  {
    id: 'wan2.7-image',
    name: 'Wan 2.7 图像',
    provider: 'Wan',
    description: '文生图 / 图生图，高质量输出',
    basePrice: 40,
    features: ['多种宽高比', '文生图 / 图生图', '快速生成'],
    priceTable: [
      { quality: '标准', price: 40 },
    ],
    isNew: true,
    isPopular: true,
    comingSoon: false,
  },
  {
    id: 'wan2.7-image-pro',
    name: 'Wan 2.7 Pro',
    provider: 'Wan',
    description: '更强细节表现与指令遵循',
    basePrice: 80,
    features: ['多种宽高比', '更高画质', '卓越细节'],
    priceTable: [
      { quality: '高清', price: 80 },
    ],
    isNew: true,
    isPopular: false,
    comingSoon: false,
  },
]

// Video models pricing
const VIDEO_MODELS = [
  {
    id: 'happyhorse',
    name: 'HappyHorse 1.0',
    provider: 'HappyHorse',
    description: '文生视频 / 图生视频，720p / 1080p 多档位',
    basePrice: 120,
    features: ['720p/1080p分辨率', '4-8秒时长', '文生 / 图生视频'],
    priceTable: [
      { duration: '4秒', price: 120 },
      { duration: '8秒', price: 200 },
    ],
    isNew: true,
    isPopular: true,
    comingSoon: false,
  },
  {
    id: 'seedance',
    name: 'Seedance',
    provider: 'Seedance',
    description: '短剧视频合成，支持参考图驱动',
    basePrice: 150,
    features: ['16:9 / 9:16', '5-10秒时长', '参考图驱动'],
    priceTable: [
      { duration: '5秒', price: 150 },
      { duration: '10秒', price: 240 },
    ],
    isNew: true,
    isPopular: false,
    comingSoon: false,
  },
  {
    id: 'hailuo',
    name: '海螺 Hailuo 2.3',
    provider: 'Hailuo',
    description: 'MiniMax 海螺 2.3（网关分组待开通）',
    basePrice: 150,
    features: ['768P/1080P分辨率', '6-10秒时长', '运镜控制'],
    priceTable: [
      { duration: '6秒', price: 150 },
      { duration: '10秒', price: 240 },
    ],
    isNew: false,
    isPopular: false,
    comingSoon: true,
  },
]

// 创作功能（Media Studio + 智能体）—— 按所用底层模型计费，不新增独立单价
const MEDIA_TOOLS = [
  {
    id: 'agent-studio',
    name: '智能体工作室',
    icon: Bot,
    iconColor: 'text-cyan-400',
    description: '自定义 AI 智能体，编排技能与插件全自动执行任务',
    basis: '按调用插件计费',
    priceHint: '图像 40 / 视频 150 积分起',
    isNew: true,
  },
  {
    id: 'short-video',
    name: 'AI短视频',
    icon: Film,
    iconColor: 'text-rose-400',
    description: '一句话或一张图，快速生成竖屏短视频',
    basis: '海螺 Hailuo / HappyHorse',
    priceHint: '120 积分起 / 条',
    isNew: true,
  },
  {
    id: 'video-to-video',
    name: '视频生成视频',
    icon: Clapperboard,
    iconColor: 'text-amber-400',
    description: '以参考视频驱动，风格化重绘生成新视频',
    basis: 'Seedance',
    priceHint: '150 积分起 / 条',
    isNew: true,
  },
  {
    id: 'ai-effects',
    name: 'AI特效',
    icon: Sparkles,
    iconColor: 'text-fuchsia-400',
    description: '挤压 / 融化 / 亲吻等趣味图像与视频特效',
    basis: '图 Wan / 视频 HappyHorse',
    priceHint: '40（图）/ 120（视频）积分起',
    isNew: true,
  },
  {
    id: 'motion-imitation',
    name: '动作模仿',
    icon: PersonStanding,
    iconColor: 'text-emerald-400',
    description: '参考图 + 参考动作视频，驱动角色复现动作',
    basis: 'Seedance / Kling',
    priceHint: '150 积分起 / 条',
    isNew: true,
  },
  {
    id: 'video-edit',
    name: '视频编辑',
    icon: Scissors,
    iconColor: 'text-blue-400',
    description: '基于输入视频的智能编辑与二次创作',
    basis: 'HappyHorse',
    priceHint: '120 积分起 / 条',
    isNew: true,
  },
]

// Credit packages
const CREDIT_PACKAGES = [
  { credits: 100, price: 10, bonus: 0 },
  { credits: 500, price: 45, bonus: 50, popular: false },
  { credits: 1000, price: 80, bonus: 200, popular: true },
  { credits: 5000, price: 350, bonus: 1500, popular: false },
]

export default function Pricing() {
  const navigate = useNavigate()
  useDocumentTitle('定价')

  const [activeCategory, setActiveCategory] = useState('image')

  const handleGetStarted = () => {
    navigate('/register')
  }

  const handleLogin = () => {
    navigate('/login')
  }

  const handleBack = () => {
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] relative">
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-pink-900/10 via-transparent to-purple-900/10" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      {/* Navigation */}
      <nav className="relative z-50 flex items-center justify-between px-4 md:px-12 py-3 md:py-4 border-b border-gray-800/50">
        <div className="flex items-center gap-2 md:gap-4">
          <button
            onClick={handleBack}
            className="p-1.5 md:p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 md:w-9 md:h-9 bg-gradient-to-br from-pink-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-pink-500/20">
              <Rocket className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={1.5} />
            </div>
            <span className="hidden sm:inline text-lg md:text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">AI智汇平台</span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={handleLogin}
            className="px-3 md:px-4 py-2 text-sm md:text-base text-gray-300 hover:text-white transition-colors"
          >
            登录
          </button>
          <button
            onClick={handleGetStarted}
            className="px-3 md:px-5 py-2 md:py-2.5 text-sm md:text-base bg-gradient-to-r from-pink-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-pink-500/30 transition-all hover:scale-105"
          >
            免费开始
          </button>
        </div>
      </nav>

      <main className="relative z-10 max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold text-white mb-3 md:mb-4">
            透明定价，按需付费
          </h1>
          <p className="text-sm md:text-lg text-gray-400 max-w-2xl mx-auto px-2">
            购买积分，按实际使用量计费，无订阅费用，无隐藏收费
          </p>
        </div>

        {/* Credit Packages */}
        <div className="mb-10 md:mb-16">
          <h2 className="text-xl md:text-2xl font-bold text-white mb-4 md:mb-6 flex items-center gap-2">
            <Zap className="w-5 h-5 md:w-6 md:h-6 text-yellow-400" />
            积分套餐
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {CREDIT_PACKAGES.map((pkg) => (
              <div
                key={pkg.credits}
                className={`relative bg-[#16161a]/80 backdrop-blur rounded-xl md:rounded-2xl border p-3 md:p-6 transition-all hover:scale-105 cursor-pointer ${
                  pkg.popular
                    ? 'border-pink-500/50 shadow-lg shadow-pink-500/20'
                    : 'border-gray-800/50 hover:border-gray-700'
                }`}
                onClick={handleGetStarted}
              >
                {pkg.popular && (
                  <div className="absolute -top-2.5 md:-top-3 left-1/2 -translate-x-1/2 px-2 md:px-3 py-0.5 md:py-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white text-[10px] md:text-xs font-medium rounded-full whitespace-nowrap">
                    最受欢迎
                  </div>
                )}
                <div className="text-center">
                  <div className="text-xl md:text-3xl font-bold text-white mb-0.5 md:mb-1">
                    {pkg.credits.toLocaleString()}
                  </div>
                  <div className="text-xs md:text-sm text-gray-400 mb-2 md:mb-4">积分</div>
                  <div className="text-lg md:text-2xl font-bold text-pink-400 mb-1 md:mb-2">
                    ¥{pkg.price}
                  </div>
                  {pkg.bonus > 0 && (
                    <div className="text-xs md:text-sm text-green-400">
                      +{pkg.bonus} 赠送
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2 mb-6 md:mb-8 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          {PRICING_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-lg md:rounded-xl text-sm md:text-base font-medium transition-all whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-lg shadow-pink-500/30'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <cat.icon className="w-4 h-4" />
              {cat.label}
            </button>
          ))}
        </div>

        {/* Image Models Pricing */}
        {activeCategory === 'image' && (
          <div className="space-y-4 md:space-y-6">
            <h2 className="text-lg md:text-2xl font-bold text-white flex items-center gap-2">
              <ImageIcon className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
              AI图片生成模型
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {IMAGE_MODELS.map((model) => (
                <div
                  key={model.id}
                  className={`relative bg-[#16161a]/80 backdrop-blur rounded-xl md:rounded-2xl border p-4 md:p-6 ${
                    model.comingSoon
                      ? 'border-gray-800/50 opacity-60'
                      : model.isPopular
                        ? 'border-pink-500/50 shadow-lg shadow-pink-500/10'
                        : 'border-gray-800/50'
                  }`}
                >
                  {model.isPopular && !model.comingSoon && (
                    <div className="absolute -top-2.5 md:-top-3 right-3 md:right-4 px-2 md:px-3 py-0.5 md:py-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white text-[10px] md:text-xs font-medium rounded-full flex items-center gap-1">
                      <Crown className="w-3 h-3" />
                      推荐
                    </div>
                  )}
                  {model.comingSoon && (
                    <div className="absolute -top-2.5 md:-top-3 right-3 md:right-4 px-2 md:px-3 py-0.5 md:py-1 bg-gray-700 text-gray-300 text-[10px] md:text-xs font-medium rounded-full">
                      即将上线
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-3 md:mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base md:text-lg font-bold text-white">{model.name}</h3>
                        {model.isNew && !model.comingSoon && (
                          <span className="px-1.5 md:px-2 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] md:text-xs rounded">New</span>
                        )}
                      </div>
                      <p className="text-xs md:text-sm text-gray-500">{model.provider}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl md:text-2xl font-bold text-pink-400">{model.basePrice}</div>
                      <div className="text-[10px] md:text-xs text-gray-500">积分起</div>
                    </div>
                  </div>
                  <p className="text-xs md:text-sm text-gray-400 mb-3 md:mb-4">{model.description}</p>

                  {/* Features */}
                  <div className="space-y-1.5 md:space-y-2 mb-3 md:mb-4">
                    {model.features.map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs md:text-sm text-gray-300">
                        <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-green-400 flex-shrink-0" />
                        {feature}
                      </div>
                    ))}
                  </div>

                  {/* Price Table */}
                  <div className="bg-black/20 rounded-lg md:rounded-xl p-2.5 md:p-3">
                    <div className="text-[10px] md:text-xs text-gray-500 mb-1.5 md:mb-2">价格明细</div>
                    <div className="space-y-1">
                      {model.priceTable.map((row, idx) => (
                        <div key={idx} className="flex justify-between text-xs md:text-sm">
                          <span className="text-gray-400">{row.quality}</span>
                          <span className="text-white font-medium">{row.price} 积分</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Video Models Pricing */}
        {activeCategory === 'video' && (
          <div className="space-y-4 md:space-y-6">
            <h2 className="text-lg md:text-2xl font-bold text-white flex items-center gap-2">
              <Video className="w-5 h-5 md:w-6 md:h-6 text-purple-400" />
              AI视频生成模型
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {VIDEO_MODELS.map((model) => (
                <div
                  key={model.id}
                  className={`relative bg-[#16161a]/80 backdrop-blur rounded-xl md:rounded-2xl border p-4 md:p-6 ${
                    model.comingSoon
                      ? 'border-gray-800/50 opacity-60'
                      : model.isPopular
                        ? 'border-pink-500/50 shadow-lg shadow-pink-500/10'
                        : 'border-gray-800/50'
                  }`}
                >
                  {model.isPopular && !model.comingSoon && (
                    <div className="absolute -top-2.5 md:-top-3 right-3 md:right-4 px-2 md:px-3 py-0.5 md:py-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white text-[10px] md:text-xs font-medium rounded-full flex items-center gap-1">
                      <Crown className="w-3 h-3" />
                      推荐
                    </div>
                  )}
                  {model.comingSoon && (
                    <div className="absolute -top-2.5 md:-top-3 right-3 md:right-4 px-2 md:px-3 py-0.5 md:py-1 bg-gray-700 text-gray-300 text-[10px] md:text-xs font-medium rounded-full">
                      即将上线
                    </div>
                  )}
                  <div className="flex items-start justify-between mb-3 md:mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base md:text-lg font-bold text-white">{model.name}</h3>
                        {model.isNew && !model.comingSoon && (
                          <span className="px-1.5 md:px-2 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] md:text-xs rounded">New</span>
                        )}
                      </div>
                      <p className="text-xs md:text-sm text-gray-500">{model.provider}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xl md:text-2xl font-bold text-pink-400">{model.basePrice}</div>
                      <div className="text-[10px] md:text-xs text-gray-500">积分起</div>
                    </div>
                  </div>
                  <p className="text-xs md:text-sm text-gray-400 mb-3 md:mb-4">{model.description}</p>

                  {/* Features */}
                  <div className="space-y-1.5 md:space-y-2 mb-3 md:mb-4">
                    {model.features.map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs md:text-sm text-gray-300">
                        <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-green-400 flex-shrink-0" />
                        {feature}
                      </div>
                    ))}
                  </div>

                  {/* Price Table */}
                  <div className="bg-black/20 rounded-lg md:rounded-xl p-2.5 md:p-3">
                    <div className="text-[10px] md:text-xs text-gray-500 mb-1.5 md:mb-2">价格明细</div>
                    <div className="space-y-1">
                      {model.priceTable.map((row, idx) => (
                        <div key={idx} className="flex justify-between text-xs md:text-sm">
                          <span className="text-gray-400">{row.duration}</span>
                          <span className="text-white font-medium">{row.price} 积分</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3D Models Pricing */}
        {activeCategory === 'features' && (
          <div className="space-y-4 md:space-y-6">
            <h2 className="text-lg md:text-2xl font-bold text-white flex items-center gap-2">
              <Wand2 className="w-5 h-5 md:w-6 md:h-6 text-fuchsia-400" />
              创作功能
            </h2>
            <p className="text-xs md:text-sm text-gray-400 -mt-2">
              以下功能按所用底层模型计费，不额外收取功能费；具体消耗以实际生成的模型与参数为准。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {MEDIA_TOOLS.map((tool) => (
                <div
                  key={tool.id}
                  className="relative bg-[#16161a]/80 backdrop-blur rounded-xl md:rounded-2xl border border-gray-800/50 p-4 md:p-6 hover:border-pink-500/30 transition-all"
                >
                  <div className="flex items-start justify-between mb-3 md:mb-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
                        <tool.icon className={`w-5 h-5 ${tool.iconColor}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base md:text-lg font-bold text-white">{tool.name}</h3>
                          {tool.isNew && (
                            <span className="px-1.5 md:px-2 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] md:text-xs rounded">New</span>
                          )}
                        </div>
                        <p className="text-[10px] md:text-xs text-gray-500">{tool.basis}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm md:text-base font-bold text-pink-400 whitespace-nowrap">{tool.priceHint}</div>
                    </div>
                  </div>
                  <p className="text-xs md:text-sm text-gray-400">{tool.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA Section */}
        <div className="mt-10 md:mt-16 text-center">
          <div className="bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-pink-500/10 rounded-2xl md:rounded-3xl border border-pink-500/20 p-6 md:p-12">
            <h2 className="text-xl md:text-3xl font-bold text-white mb-3 md:mb-4">
              准备好开始创作了吗？
            </h2>
            <p className="text-sm md:text-base text-gray-400 mb-6 md:mb-8 max-w-xl mx-auto">
              注册即送 100 积分，立即体验全球顶尖AI模型
            </p>
            <button
              onClick={handleGetStarted}
              className="px-6 md:px-8 py-3 md:py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-pink-500/30 transition-all hover:scale-105 text-base md:text-lg"
            >
              免费开始使用
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 md:py-8 text-center text-xs md:text-sm text-gray-500 border-t border-gray-800/50 mt-8 md:mt-12">
        <p>© 2024 AI智汇平台. All rights reserved.</p>
      </footer>
    </div>
  )
}
