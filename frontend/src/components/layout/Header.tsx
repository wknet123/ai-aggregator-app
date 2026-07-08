import { useEffect } from 'react'
import { useAuthStore } from '../../store/auth.store'
import { useCreditStore } from '../../store/credit.store'
import { useNavigate, useLocation } from 'react-router-dom'
import { Menu, Rocket, Gem } from 'lucide-react'

// 余额定时轮询间隔(ms)。积分扣减在后台任务中异步发生,
// 用户停留同一页面时需要定时刷新,否则右上角会显示陈旧余额。
const BALANCE_POLL_INTERVAL = 20000

interface HeaderProps {
  onMenuToggle?: () => void
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const { user, logout } = useAuthStore()
  const { balance: rawBalance, fetchBalance } = useCreditStore()
  const balance = typeof rawBalance === 'number' ? rawBalance : parseFloat(String(rawBalance)) || 0
  const navigate = useNavigate()
  const location = useLocation()

  // 路由切换时刷新余额(覆盖页面跳转后扣分的场景)
  useEffect(() => {
    if (user) {
      fetchBalance()
    }
  }, [user, fetchBalance, location.pathname])

  // 定时轮询 + 窗口重新聚焦/可见时刷新,确保后台异步扣分后右上角余额保持最新
  useEffect(() => {
    if (!user) return

    const timer = window.setInterval(fetchBalance, BALANCE_POLL_INTERVAL)

    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchBalance()
      }
    }
    window.addEventListener('focus', fetchBalance)
    document.addEventListener('visibilitychange', refreshOnVisible)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', fetchBalance)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [user, fetchBalance])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <header className="bg-[#0d0d0f] border-b border-gray-800/50">
      <div className="flex items-center justify-between px-4 md:px-8 py-3 md:py-4">
        {/* Left: Menu button (mobile) + Logo */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Mobile menu button */}
          <button
            onClick={onMenuToggle}
            className="md:hidden hover:bg-white/10 p-2 rounded-lg transition-all"
          >
            <Menu className="w-5 h-5 text-gray-300" />
          </button>
          
          <h1
            className="text-lg md:text-2xl font-bold text-white flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => navigate('/gallery')}
          >
            <span className="bg-gradient-to-r from-pink-500 to-purple-500 p-1.5 md:p-2 rounded-lg">
              <Rocket className="w-4 h-4 md:w-5 md:h-5 text-white" strokeWidth={1.5} />
            </span>
            <span className="hidden sm:inline bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">AI智汇平台</span>
            <span className="sm:hidden bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">AI智汇平台</span>
          </h1>
        </div>
        
        {/* Right: Balance + User */}
        <div className="flex items-center gap-2 md:gap-4">
          <div 
            className="flex items-center text-xs md:text-sm cursor-pointer hover:bg-white/10 bg-[#1a1a1f] px-2 md:px-4 py-1.5 md:py-2 rounded-full transition-all border border-gray-700/50" 
            onClick={() => navigate('/credits')}
          >
            <Gem className="w-3.5 h-3.5 md:w-4 md:h-4 text-pink-400 mr-1" strokeWidth={1.5} />
            <span className="hidden md:inline text-gray-400">积分余额:</span>
            <span className="ml-1 md:ml-2 font-bold text-pink-400">
              {Math.round(balance)}
            </span>
            <span className="text-gray-500 ml-0.5">分</span>
          </div>
          
          <div className="flex items-center gap-2 md:gap-3">
            <span className="hidden md:inline text-sm font-medium text-gray-300">{user?.username}</span>
            <button
              onClick={handleLogout}
              className="hover:bg-white/10 bg-[#1a1a1f] text-gray-300 px-2 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium transition-all border border-gray-700/50"
            >
              <span className="hidden md:inline">退出登录</span>
              <span className="md:hidden">退出</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
