import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/auth.store'
import { useCreditStore } from '../store/credit.store'
import { creditService } from '../services/credit.service'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'

export default function Dashboard() {
  const { user } = useAuthStore()
  const { balance, setBalance } = useCreditStore()
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <h1 className="text-3xl font-bold mb-8 text-gray-100">控制台</h1>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-[#16161a] border border-gray-800/50 rounded-xl p-6 hover:border-pink-500/30 transition-all">
              <h3 className="text-lg font-semibold mb-2 text-gray-300">积分余额</h3>
              <p className="text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                {loading ? '...' : `${Math.round(balance)}`}
              </p>
            </div>

            <div className="bg-[#16161a] border border-gray-800/50 rounded-xl p-6 hover:border-pink-500/30 transition-all">
              <h3 className="text-lg font-semibold mb-2 text-gray-300">用户</h3>
              <p className="text-xl text-gray-100">{user?.username}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>

            <div className="bg-[#16161a] border border-gray-800/50 rounded-xl p-6 hover:border-pink-500/30 transition-all">
              <h3 className="text-lg font-semibold mb-2 text-gray-300">状态</h3>
              <span className="inline-block px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/30 rounded-full text-sm">
                正常
              </span>
            </div>
          </div>

          <div className="bg-[#16161a] border border-gray-800/50 rounded-xl p-6">
            <h2 className="text-2xl font-bold mb-4 text-gray-100">快速开始</h2>
            <p className="text-gray-400 mb-4">
              欢迎来到AI智汇平台！开始使用我们的AI模型：
            </p>
            <ul className="space-y-2 text-gray-300">
              <li>• DeepSeek V4 文本生成</li>
              <li>• Wan 2.7 图片创作</li>
              <li>• HappyHorse / Seedance 视频生成</li>
              <li>• Seedance 短剧视频合成</li>
              <li>• AI短剧一站式创作</li>
            </ul>
          </div>
        </main>
      </div>
    </div>
  )
}
