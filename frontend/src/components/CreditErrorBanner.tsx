import { AlertCircle, CreditCard } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/** True when an error message is an "insufficient credits" rejection (中/英两种文案). */
export const isInsufficientCredit = (msg?: string) =>
  !!msg && (msg.includes('积分不足') || /insufficient credits/i.test(msg))

/**
 * Red error banner. When the message is an insufficient-credit error it also shows
 * a "去充值" link that jumps to /recharge carrying the current page as `redirect`,
 * so the recharge page can send the user back here after a successful top-up.
 */
export default function CreditErrorBanner({
  message,
  className = '',
}: {
  message?: string
  className?: string
}) {
  const navigate = useNavigate()
  if (!message) return null

  const goRecharge = () => {
    // 指向实际在用的中文充值页 /credits(Header/侧栏「积分」也是它),携带当前页以便付款后跳回。
    const here = window.location.pathname + window.location.search
    navigate(`/credits?redirect=${encodeURIComponent(here)}`)
  }

  return (
    <div className={`text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 flex items-center gap-2 ${className}`}>
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 min-w-0">{message}</span>
      {isInsufficientCredit(message) && (
        <button
          onClick={goRecharge}
          className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 text-xs font-medium transition-colors whitespace-nowrap"
        >
          <CreditCard className="w-3.5 h-3.5" />
          去充值
        </button>
      )}
    </div>
  )
}
