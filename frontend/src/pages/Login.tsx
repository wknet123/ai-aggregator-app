import React, { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/store/auth.store'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { Rocket, AlertTriangle } from 'lucide-react'
import CaptchaField from '@/components/CaptchaField'

export default function Login() {
  const navigate = useNavigate()
  useDocumentTitle('登录')

  const { setAuth } = useAuthStore()
  const [formData, setFormData] = useState({ username: '', password: '' })
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaImage, setCaptchaImage] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refreshCaptcha = async () => {
    setCaptchaLoading(true)
    try {
      const data = await authService.getCaptcha()
      setCaptchaToken(data.captcha_token)
      setCaptchaImage(data.captcha_image)
      setCaptchaAnswer('')
    } catch {
      // 静默失败；用户可点击刷新重试
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => {
    refreshCaptcha()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await authService.login({
        ...formData,
        captcha_token: captchaToken,
        captcha_answer: captchaAnswer,
      })
      setAuth(response)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.detail || err.response?.data?.message || 'Login failed')
      refreshCaptcha()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0d0f] relative overflow-hidden p-4">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img
          src="/api/v1/static/a831edea1bf5.jpg"
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/90" />
        <div className="absolute inset-0 bg-gradient-to-r from-pink-900/20 via-transparent to-purple-900/20" />
      </div>
      {/* Animated glow effects */}
      <div className="absolute inset-0 opacity-40 z-[1]">
        <div className="absolute top-10 md:top-20 left-10 md:left-20 w-40 md:w-72 h-40 md:h-72 bg-pink-500 rounded-full mix-blend-screen filter blur-3xl animate-pulse"></div>
        <div className="absolute top-20 md:top-40 right-10 md:right-20 w-48 md:w-96 h-48 md:h-96 bg-purple-500 rounded-full mix-blend-screen filter blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute bottom-10 md:bottom-20 left-1/2 w-40 md:w-80 h-40 md:h-80 bg-pink-600 rounded-full mix-blend-screen filter blur-3xl animate-pulse delay-500"></div>
      </div>
      <div className="relative max-w-md w-full z-10">
        <div className="absolute -inset-1 bg-gradient-to-r from-pink-500 via-purple-500 to-pink-500 rounded-2xl blur opacity-30"></div>
        <div className="relative bg-[#16161a]/90 backdrop-blur-xl rounded-2xl shadow-2xl p-6 md:p-8 border border-gray-800/50">
          <div className="text-center mb-6 md:mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 md:w-16 md:h-16 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl mb-3 md:mb-4 shadow-lg shadow-pink-500/20">
              <Rocket className="w-7 h-7 md:w-8 md:h-8 text-white" strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">AI智汇平台</h2>
            <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-base">欢迎回来，请登录您的账户</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-3 md:px-4 py-2 md:py-3 rounded-xl mb-4 md:mb-6 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4" strokeWidth={1.5} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5 md:mb-2">用户名</label>
              <input
                type="text"
                className="w-full px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-[#1a1a1f] border border-gray-700/50 text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all outline-none text-sm md:text-base placeholder:text-gray-600"
                placeholder="请输入用户名"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5 md:mb-2">密码</label>
              <input
                type="password"
                className="w-full px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-[#1a1a1f] border border-gray-700/50 text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all outline-none text-sm md:text-base placeholder:text-gray-600"
                placeholder="请输入密码"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
            </div>

            <CaptchaField
              image={captchaImage}
              answer={captchaAnswer}
              onAnswerChange={setCaptchaAnswer}
              onRefresh={refreshCaptcha}
              loading={captchaLoading}
            />

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-pink-500 to-purple-500 text-white py-2.5 md:py-3 rounded-xl font-medium hover:shadow-lg hover:shadow-pink-500/20 transition-all duration-300 disabled:opacity-50 text-sm md:text-base"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  登录中...
                </span>
              ) : '登录'}
            </button>
          </form>

          <p className="text-center mt-6 text-sm text-gray-500">
            还没有账户？{' '}
            <Link to="/register" className="text-pink-400 hover:text-pink-300 font-medium hover:underline">
              立即注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
