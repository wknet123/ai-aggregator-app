import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import { Bot } from 'lucide-react'
import ProviderLogo from '@/components/model/ProviderLogo'

export default function Models() {
  const models = [
    { provider: 'Wan', models: ['Wan 2.7 图像', 'Wan 2.7 Pro'] },
    { provider: 'HappyHorse', models: ['HappyHorse 1.0'] },
    { provider: 'Seedance', models: ['Seedance 短剧视频'] },
    { provider: 'Hailuo', models: ['海螺 Hailuo 2.3 (即将上线)'] },
    { provider: 'DeepSeek', models: ['DeepSeek V4 文本'] },
  ]

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <h1 className="text-3xl font-bold mb-8 bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent flex items-center gap-3">
            <Bot className="w-8 h-8 text-pink-500" strokeWidth={1.5} />
            可用模型
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {models.map((provider) => (
              <div key={provider.provider} className="bg-[#16161a] border border-gray-800/50 rounded-xl p-6 hover:border-pink-500/30 hover:shadow-lg hover:shadow-pink-500/5 transition-all">
                <h3 className="text-xl font-bold mb-4 text-gray-100 flex items-center gap-2.5">
                  <ProviderLogo provider={provider.provider} size={28} />
                  {provider.provider}
                </h3>
                <ul className="space-y-3">
                  {provider.models.map((model) => (
                    <li key={model} className="flex items-center justify-between">
                      <span className="text-gray-300">{model}</span>
                      <button className="px-3 py-1.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white text-sm rounded-lg hover:shadow-lg hover:shadow-pink-500/20 transition-all">使用模型</button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
