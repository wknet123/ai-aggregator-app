import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LayoutGrid, CreditCard, Settings, ImageIcon, Video, Gem, X, Plus, Home, Compass, Layers, Sparkles, Film, Clapperboard, PersonStanding, Scissors, Bot, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

export default function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  // Navigation group
  const navigationLinks = [
    { to: '/gallery', icon: LayoutGrid, label: '作品画廊' },
    { to: '/discover', icon: Compass, label: '发现' },
  ]

  // AI Creation group - preserved from original creationLinks
  const creationLinks = [
    { to: '/image-generation', icon: ImageIcon, label: 'AI图片' },
    { to: '/video-generation', icon: Video, label: 'AI视频' },
    { to: '/short-video', icon: Film, label: 'AI短视频' },
    { to: '/video-to-video', icon: Clapperboard, label: '视频生成视频' },
    { to: '/ai-effects', icon: Sparkles, label: 'AI特效' },
    { to: '/motion-imitation', icon: PersonStanding, label: '动作模仿' },
    { to: '/video-edit', icon: Scissors, label: '视频编辑' },
  ]

  // Tools group
  const toolLinks = [
    { to: '/omni-weaver', icon: Layers, label: 'OmniWeaver', badge: 'New' },
    { to: '/agent-studio', icon: Bot, label: '智能体工作室', badge: 'New' },
  ]

  // Account group - preserved from original otherLinks
  const otherLinks = [
    { to: '/credits', icon: Gem, label: '积分' },
    { to: '/settings', icon: Settings, label: '设置' },
  ]

  // Admin group - 仅管理员可见
  const adminLinks = [
    { to: '/admin/gateway', icon: ShieldCheck, label: '网关管理' },
  ]

  const handleLinkClick = () => {
    // Close sidebar on mobile after clicking a link
    if (onClose) {
      onClose()
    }
  }

  const handleNewCreate = () => {
    navigate('/image-generation')
    if (onClose) {
      onClose()
    }
  }

  const renderLink = ({ to, icon: Icon, label, badge, disabled, comingSoon }: { to: string; icon: any; label: string; badge?: string; disabled?: boolean; comingSoon?: boolean }) => (
    <li key={to}>
      {disabled ? (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 cursor-not-allowed">
          <Icon className="w-5 h-5" strokeWidth={1.5} />
          <span className="text-sm">{label}</span>
          <span className="ml-auto text-[9px] bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded-full">
            即将上线
          </span>
        </div>
      ) : (
        <Link
          to={to}
          onClick={handleLinkClick}
          className={location.pathname === to ? 'sidebar-link-active' : 'sidebar-link-inactive'}
        >
          <Icon className="w-5 h-5" strokeWidth={1.5} />
          <span className="text-sm">{label}</span>
          {comingSoon && (
            <span className="ml-auto text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">
              即将上线
            </span>
          )}
          {badge && !comingSoon && (
            <span className="ml-auto text-[10px] bg-gradient-to-r from-pink-500 to-purple-500 text-white px-1.5 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </Link>
      )}
    </li>
  )

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/70 z-40"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:relative z-50 md:z-auto
        w-56 bg-[#0d0d0f]
        h-[calc(100vh-56px)] md:h-[calc(100vh-64px)] border-r border-gray-800/50
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <nav className="p-3 h-full overflow-y-auto scrollbar-none">
          {/* Mobile close button */}
          <div className="md:hidden flex justify-end mb-2">
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* + 新建 Button */}
          <button
            onClick={handleNewCreate}
            className="btn-new-create mb-4"
          >
            <Plus className="w-5 h-5" strokeWidth={2} />
            <span>新建创作</span>
          </button>

          {/* Navigation Section */}
          <div className="mb-2">
            <p className="sidebar-group-title">导航</p>
            <ul className="space-y-0.5">
              {navigationLinks.map(renderLink)}
            </ul>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-800/50 my-3"></div>

          {/* AI Creation Section */}
          <div className="mb-2">
            <p className="sidebar-group-title">AI 创作</p>
            <ul className="space-y-0.5">
              {creationLinks.map(renderLink)}
            </ul>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-800/50 my-3"></div>

          {/* Tools Section */}
          <div className="mb-2">
            <p className="sidebar-group-title">工具</p>
            <ul className="space-y-0.5">
              {toolLinks.map(renderLink)}
            </ul>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-800/50 my-3"></div>

          {/* Account Section */}
          <div>
            <p className="sidebar-group-title">账户</p>
            <ul className="space-y-0.5">
              {otherLinks.map(renderLink)}
            </ul>
          </div>

          {/* Admin Section - 仅管理员 */}
          {user?.is_admin && (
            <>
              <div className="border-t border-gray-800/50 my-3"></div>
              <div>
                <p className="sidebar-group-title">管理</p>
                <ul className="space-y-0.5">
                  {adminLinks.map(renderLink)}
                </ul>
              </div>
            </>
          )}
        </nav>
      </aside>
    </>
  )
}
