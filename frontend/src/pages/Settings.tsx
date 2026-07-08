import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { useCreditStore } from '@/store/credit.store'
import { creditService } from '@/services/credit.service'
import { authService } from '@/services/auth.service'
import { douyinService, DouyinConnection } from '@/services/douyin.service'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import {
  Settings as SettingsIcon, User, Bot, FileText, Key, CheckCircle,
  ImageIcon, Video, Share2,
  Loader2, Unlink, ExternalLink, LogOut,
} from 'lucide-react'

const FEATURE_SECTIONS = [
  {
    title: 'AI图片',
    icon: ImageIcon,
    color: 'pink',
    models: ['Wan 2.7 图像', 'Wan 2.7 Pro'],
    description: '文生图 / 图生图',
    route: '/image-generation',
  },
  {
    title: 'AI视频',
    icon: Video,
    color: 'purple',
    models: ['HappyHorse 1.0', 'Seedance'],
    description: '文生视频 / 图生视频',
    route: '/video-generation',
  },
]

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
  pink:    { bg: 'bg-pink-500/10',    text: 'text-pink-400',    border: 'border-pink-500/20',    iconBg: 'bg-pink-500/20' },
  purple:  { bg: 'bg-purple-500/10',  text: 'text-purple-400',  border: 'border-purple-500/20',  iconBg: 'bg-purple-500/20' },
  orange:  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/20',  iconBg: 'bg-orange-500/20' },
  cyan:    { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    border: 'border-cyan-500/20',    iconBg: 'bg-cyan-500/20' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', iconBg: 'bg-emerald-500/20' },
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/20',   iconBg: 'bg-amber-500/20' },
}

export default function Settings() {
  useDocumentTitle('设置')
  const navigate = useNavigate()

  const { user, setUser, logout } = useAuthStore()
  const { balance, setBalance } = useCreditStore()
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Profile form
  const [fullName, setFullName] = useState(user?.full_name || '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')

  // Sync fullName when user data loads/changes (e.g. after zustand hydration)
  useEffect(() => {
    setFullName(user?.full_name || '')
  }, [user?.id])

  // Douyin connection
  const [douyinConn, setDouyinConn] = useState<DouyinConnection | null>(null)
  const [douyinLoading, setDouyinLoading] = useState(true)
  const [douyinError, setDouyinError] = useState('')

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const data = await creditService.getBalance()
        setBalance(data.balance)
      } catch (error) {
        console.error('Failed to fetch balance:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchBalance()
  }, [setBalance])

  // Load Douyin connection status
  useEffect(() => {
    douyinService.getConnection()
      .then(setDouyinConn)
      .catch(() => setDouyinConn({ connected: false }))
      .finally(() => setDouyinLoading(false))
  }, [])

  // Listen for Douyin OAuth callback
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'douyin-callback' && e.data?.success) {
        douyinService.getConnection().then(setDouyinConn).catch(() => {})
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleProfileSave = async () => {
    setProfileSaving(true)
    setProfileMsg('')
    try {
      const updated = await authService.updateProfile({ full_name: fullName.trim() || undefined })
      setUser(updated)
      setProfileMsg('保存成功')
      setTimeout(() => setProfileMsg(''), 3000)
    } catch (err: any) {
      setProfileMsg(err?.response?.data?.detail || '保存失败')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleDouyinConnect = async () => {
    setDouyinError('')
    try {
      const url = await douyinService.getAuthUrl()
      window.open(url, 'douyin_oauth', 'width=600,height=700')
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '抖音授权失败，请稍后重试'
      setDouyinError(msg)
      setTimeout(() => setDouyinError(''), 8000)
    }
  }

  const handleDouyinDisconnect = async () => {
    try {
      await douyinService.disconnect()
      setDouyinConn({ connected: false })
    } catch {}
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)] overflow-hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 h-full overflow-y-auto bg-[#0d0d0f] p-4 md:p-8">
          <div className="w-full">
            {/* Page Header */}
            <div className="mb-6 md:mb-8">
              <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2 md:gap-3">
                <span className="bg-gradient-to-r from-pink-500 to-purple-500 p-1.5 md:p-2 rounded-xl text-white">
                  <SettingsIcon className="w-5 h-5 md:w-6 md:h-6" strokeWidth={1.5} />
                </span>
                设置
              </h1>
              <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-base">管理您的账户、连接和偏好设置</p>
            </div>

            {/* Account Overview */}
            <div className="bg-[#16161a] border border-gray-800/50 rounded-2xl p-4 md:p-6 mb-4">
              <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-3 flex items-center gap-2">
                <User className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                账户概览
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                <div className="p-3 bg-gradient-to-br from-pink-500/10 to-purple-500/10 rounded-xl border border-pink-500/20">
                  <h3 className="text-xs md:text-sm font-medium text-gray-400 mb-1">积分余额</h3>
                  <p className="text-xl md:text-2xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                    {loading ? '...' : `${Math.round(balance)}`}
                  </p>
                </div>
                <div className="p-3 bg-[#1a1a1f] rounded-xl border border-gray-800/50">
                  <h3 className="text-xs md:text-sm font-medium text-gray-400 mb-1">用户名</h3>
                  <p className="text-base md:text-lg font-medium text-gray-200">{user?.username}</p>
                  <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                </div>
                <div className="p-3 bg-[#1a1a1f] rounded-xl border border-gray-800/50">
                  <h3 className="text-xs md:text-sm font-medium text-gray-400 mb-1">账户状态</h3>
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs font-medium border border-green-500/30">
                    <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.5} /> 正常
                  </span>
                </div>
              </div>
            </div>

            {/* Profile Settings */}
            <div className="bg-[#16161a] border border-gray-800/50 rounded-2xl p-4 md:p-6 mb-4">
              <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                个人资料
              </h2>
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">用户名</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2.5 bg-[#1a1a1f] border border-gray-700/50 rounded-xl text-gray-500 cursor-not-allowed text-sm"
                      value={user?.username || ''}
                      disabled
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">邮箱</label>
                    <input
                      type="email"
                      className="w-full px-4 py-2.5 bg-[#1a1a1f] border border-gray-700/50 rounded-xl text-gray-500 cursor-not-allowed text-sm"
                      value={user?.email || ''}
                      disabled
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">姓名</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2.5 bg-[#1a1a1f] border border-gray-700/50 rounded-xl text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all placeholder:text-gray-600 text-sm"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="请输入姓名"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleProfileSave}
                    disabled={profileSaving}
                    className="bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-2 rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-pink-500/20 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {profileSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    保存
                  </button>
                  {profileMsg && (
                    <span className={`text-sm ${profileMsg === '保存成功' ? 'text-green-400' : 'text-red-400'}`}>
                      {profileMsg}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Third-party Connections */}
            <div className="bg-[#16161a] border border-gray-800/50 rounded-2xl p-4 md:p-6 mb-4">
              <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-3 flex items-center gap-2">
                <Share2 className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                第三方账号
              </h2>
              <div className="space-y-3">
                {/* Douyin */}
                <div className="flex items-center justify-between p-3 bg-[#1a1a1f] rounded-xl border border-gray-800/50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-pink-500/20 rounded-xl flex items-center justify-center">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                        <path d="M16.6 5.82s.51.5 0 0A4.278 4.278 0 0 1 19.5 2h1v4.5a5 5 0 0 1-5 5h-.5v5a4 4 0 1 1-4-4v2a2 2 0 1 0 2 2V2h3.5c0 1.5.64 3.03 1.1 3.82Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-pink-400" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-200">抖音</p>
                      {douyinLoading ? (
                        <p className="text-xs text-gray-500">加载中...</p>
                      ) : douyinConn?.connected ? (
                        <p className="text-xs text-green-400">已连接{douyinConn.nickname ? ` - ${douyinConn.nickname}` : ''}</p>
                      ) : (
                        <p className="text-xs text-gray-500">未连接 - 连接后可一键发布视频到抖音</p>
                      )}
                    </div>
                  </div>
                  {douyinLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                  ) : douyinConn?.connected ? (
                    <button
                      onClick={handleDouyinDisconnect}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-red-400 border border-gray-700/50 hover:border-red-500/30 rounded-lg transition-colors"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      解绑
                    </button>
                  ) : (
                    <button
                      onClick={handleDouyinConnect}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-pink-400 border border-pink-500/30 hover:bg-pink-500/10 rounded-lg transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      连接
                    </button>
                  )}
                </div>
              </div>
              {douyinError && (
                <p className="mt-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  {douyinError}
                </p>
              )}
            </div>

            {/* Available Features & Models */}
            <div className="bg-[#16161a] border border-gray-800/50 rounded-2xl p-4 md:p-6 mb-4">
              <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-3 flex items-center gap-2">
                <Bot className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                可用功能与模型
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {FEATURE_SECTIONS.map((section) => {
                  const c = COLOR_MAP[section.color]
                  const Icon = section.icon
                  return (
                    <button
                      key={section.title}
                      onClick={() => navigate(section.route)}
                      className={`text-left p-3 rounded-xl border ${c.border} hover:bg-white/[0.02] transition-colors group`}
                    >
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className={`w-8 h-8 ${c.iconBg} rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform`}>
                          <Icon className={`w-4 h-4 ${c.text}`} />
                        </div>
                        <span className="text-sm font-semibold text-gray-100">{section.title}</span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{section.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {section.models.map((m) => (
                          <span key={m} className={`px-1.5 py-0.5 ${c.bg} ${c.text} text-[10px] rounded`}>
                            {m}
                          </span>
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* API Keys */}
            <div className="bg-[#16161a] border border-gray-800/50 rounded-2xl p-4 md:p-6 mb-4">
              <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-3 flex items-center gap-2">
                <Key className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                API 访问
              </h2>
              <p className="text-sm text-gray-400 mb-3">
                管理用于程序调用AI模型的API密钥
              </p>
              <button className="bg-gradient-to-r from-pink-500 to-purple-500 text-white px-6 py-2 rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-pink-500/20 transition-all">
                生成API密钥
              </button>
            </div>

            {/* Logout */}
            <div className="bg-[#16161a] border border-gray-800/50 rounded-2xl p-4 md:p-6">
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-5 py-2 text-sm text-red-400 border border-red-500/20 hover:bg-red-500/10 rounded-xl transition-colors"
              >
                <LogOut className="w-4 h-4" />
                退出登录
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
