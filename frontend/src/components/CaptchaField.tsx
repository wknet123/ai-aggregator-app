import { RefreshCw } from 'lucide-react'

interface CaptchaFieldProps {
  image: string
  answer: string
  onAnswerChange: (value: string) => void
  onRefresh: () => void
  loading?: boolean
}

/**
 * 图形验证码输入组件：左侧输入框 + 右侧图片（点击刷新）。登录/注册共用。
 * 沿用登录页深色 input 样式。
 */
export default function CaptchaField({ image, answer, onAnswerChange, onRefresh, loading }: CaptchaFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-400 mb-1.5 md:mb-2">验证码</label>
      <div className="flex items-center gap-2 md:gap-3">
        <input
          type="text"
          autoComplete="off"
          className="flex-1 min-w-0 px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-[#1a1a1f] border border-gray-700/50 text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all outline-none text-sm md:text-base placeholder:text-gray-600"
          placeholder="请输入验证码"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          required
        />
        <button
          type="button"
          onClick={onRefresh}
          title="点击刷新验证码"
          className="relative shrink-0 h-[42px] md:h-[50px] w-[110px] rounded-xl overflow-hidden border border-gray-700/50 bg-[#1a1a1f] group"
        >
          {image ? (
            <img src={image} alt="验证码" className="w-full h-full object-cover" />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-xs text-gray-500">加载中...</span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
            <RefreshCw className={`w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity ${loading ? 'animate-spin opacity-100' : ''}`} />
          </span>
        </button>
      </div>
    </div>
  )
}
