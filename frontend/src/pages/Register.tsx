import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authService } from '@/services/auth.service'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { Sparkles, AlertTriangle } from 'lucide-react'

export default function Register() {
  const navigate = useNavigate()
  useDocumentTitle('注册')

  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    full_name: '',
    tenant_name: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await authService.register(formData)
      navigate('/login')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0d0f] py-6 md:py-8 px-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-10 right-10 md:right-20 w-40 md:w-72 h-40 md:h-72 bg-pink-500 rounded-full mix-blend-screen filter blur-3xl animate-pulse"></div>
        <div className="absolute bottom-10 md:bottom-20 left-10 md:left-20 w-48 md:w-96 h-48 md:h-96 bg-purple-500 rounded-full mix-blend-screen filter blur-3xl animate-pulse delay-1000"></div>
        <div className="absolute top-1/2 right-1/3 w-40 md:w-80 h-40 md:h-80 bg-pink-600 rounded-full mix-blend-screen filter blur-3xl animate-pulse delay-500"></div>
      </div>
      <div className="relative max-w-md w-full">
        <div className="absolute -inset-1 bg-gradient-to-r from-pink-500 via-purple-500 to-pink-500 rounded-2xl blur opacity-30"></div>
        <div className="relative bg-[#16161a]/90 backdrop-blur-xl rounded-2xl shadow-2xl p-5 md:p-8 border border-gray-800/50">
          <div className="text-center mb-4 md:mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 md:w-16 md:h-16 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl mb-3 md:mb-4 shadow-lg shadow-pink-500/20">
              <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-white" strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">AI智汇平台</h2>
            <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-base">创建账户，开启您的AI创作之旅</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-3 md:px-4 py-2 md:py-3 rounded-xl mb-4 md:mb-6 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4" strokeWidth={1.5} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5 md:mb-2">邮箱</label>
              <input
                type="email"
                className="w-full px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-[#1a1a1f] border border-gray-700/50 text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all outline-none text-sm md:text-base placeholder:text-gray-600"
                placeholder="请输入邮箱"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5 md:mb-2">用户名</label>
              <input
                type="text"
                className="w-full px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-[#1a1a1f] border border-gray-700/50 text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all outline-none text-sm md:text-base placeholder:text-gray-600"
                placeholder="设置用户名"
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
                placeholder="设置密码"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5 md:mb-2">姓名</label>
              <input
                type="text"
                className="w-full px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-[#1a1a1f] border border-gray-700/50 text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all outline-none text-sm md:text-base placeholder:text-gray-600"
                placeholder="请输入姓名"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5 md:mb-2">组织名称</label>
              <input
                type="text"
                className="w-full px-3 md:px-4 py-2.5 md:py-3 rounded-xl bg-[#1a1a1f] border border-gray-700/50 text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all outline-none text-sm md:text-base placeholder:text-gray-600"
                placeholder="组织名称（选填）"
                value={formData.tenant_name}
                onChange={(e) => setFormData({ ...formData, tenant_name: e.target.value })}
              />
            </div>

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
                  注册中...
                </span>
              ) : '注册'}
            </button>
          </form>

          <p className="text-center mt-6 text-sm text-gray-500">
            已有账户？{' '}
            <Link to="/login" className="text-pink-400 hover:text-pink-300 font-medium hover:underline">
              立即登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
