import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { useCreditStore } from '../store/credit.store'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { CreditCard, ShoppingCart, Clock, AlertCircle, X, Zap, Crown, Star, Gem } from 'lucide-react'
import { creditService } from '../services/credit.service'
import { paymentService } from '../services/payment.service'
import type { Transaction } from '../types/credit.types'
import type { CreditPackage, PaymentOrder } from '../types/payment.types'

const BADGE_COLORS: Record<string, string> = {
  '热门': 'bg-red-500',
  '推荐': 'bg-blue-500',
  '超值': 'bg-green-500',
  '限时': 'bg-purple-500',
}

const BADGE_ICONS: Record<string, React.ElementType> = {
  '热门': Star,
  '推荐': Crown,
  '超值': Zap,
  '限时': Clock,
}

export default function Credits() {
  useDocumentTitle('我的积分')

  const { balance: rawBalance, setBalance, setCredit } = useCreditStore()
  const balance = typeof rawBalance === 'number' ? rawBalance : parseFloat(String(rawBalance)) || 0

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false)
  
  // 支付相关状态
  const [packages, setPackages] = useState<CreditPackage[]>([])
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null)
  const [currentOrder, setCurrentOrder] = useState<PaymentOrder | null>(null)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const [creditInfo, txs] = await Promise.all([
          creditService.getCreditInfo().catch(() => ({ balance: 0, id: 0, total_recharged: 0, total_consumed: 0, tenant_id: 0, created_at: '', updated_at: '' })),
          creditService.getTransactions().catch(() => [])
        ])
        
        console.log('Credit info:', creditInfo)
        if (setBalance) setBalance(creditInfo.balance as number)
        if (setCredit) setCredit(creditInfo)
        setTransactions(txs)
      } catch (error: any) {
        console.error('Failed to fetch credit data:', error)
        setError(error?.response?.data?.message || 'Failed to load credit data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [setBalance, setCredit])

  // 加载积分套餐
  useEffect(() => {
    loadPackages()
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [])

  const loadPackages = async () => {
    try {
      setPackagesLoading(true)
      const data = await paymentService.getPackages()
      setPackages(data)
    } catch (err: any) {
      console.error('Failed to load packages:', err)
      setError(err.response?.data?.detail || '加载套餐失败')
    } finally {
      setPackagesLoading(false)
    }
  }

  const handlePurchase = async (pkg: CreditPackage) => {
    setSelectedPackage(pkg)
    setPurchaseLoading(true)
    setError(null)

    try {
      const order = await paymentService.createOrder({
        package_id: pkg.id,
        payment_method: 'ALIPAY',
      })

      setCurrentOrder(order)
      setShowPaymentModal(true)

      // 开始轮询订单状态
      startPollingOrderStatus(order.order_no)
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建订单失败')
    } finally {
      setPurchaseLoading(false)
    }
  }

  const startPollingOrderStatus = (orderNo: string) => {
    // 每3秒查询一次订单状态
    const interval = setInterval(async () => {
      try {
        const result = await paymentService.queryOrder(orderNo)

        if (result.order.status === 'SUCCESS') {
          // 支付成功
          clearInterval(interval)
          setPollingInterval(null)
          setShowPaymentModal(false)
          alert('支付成功！积分已充值到账。')
          // 刷新积分数据
          const creditInfo = await creditService.getCreditInfo()
          if (setBalance) setBalance(creditInfo.balance as number)
          if (setCredit) setCredit(creditInfo)
          // 若来自某页面的「去充值」(?redirect=),付款成功后跳回该页。
          // 只接受站内绝对路径,避免开放重定向;正常从侧栏进入(无 redirect)则留在本页。
          const redirect = new URLSearchParams(window.location.search).get('redirect')
          if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
            window.location.href = redirect
          }
        } else if (result.order.status === 'FAILED' || result.order.status === 'CANCELLED') {
          // 支付失败或取消
          clearInterval(interval)
          setPollingInterval(null)
          setError(result.order.error_message || '支付失败')
        } else if (result.is_expired) {
          // 订单过期
          clearInterval(interval)
          setPollingInterval(null)
          setError('订单已过期，请重新下单')
        }

        // 更新订单状态
        setCurrentOrder(result.order)
      } catch (err) {
        console.error('Failed to poll order status:', err)
      }
    }, 3000)

    setPollingInterval(interval)
  }

  const closePaymentModal = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      setPollingInterval(null)
    }
    setShowPaymentModal(false)
    setCurrentOrder(null)
  }

  const getDiscountPercentage = (pkg: CreditPackage): number | null => {
    if (pkg.original_price && Number(pkg.original_price) > Number(pkg.price)) {
      return Math.round((1 - Number(pkg.price) / Number(pkg.original_price)) * 100)
    }
    return null
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0d0f]">
        <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="flex-1 p-4 md:p-8">
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2 md:gap-3">
              <span className="bg-gradient-to-r from-pink-500 to-purple-500 p-1.5 md:p-2 rounded-xl text-white">
                <Gem className="w-5 h-5 md:w-6 md:h-6" strokeWidth={1.5} />
              </span>
              积分
            </h1>
            <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-base">管理您的AI积分并购买套餐</p>
          </div>

          <div>
            {error && (
              <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <p className="text-red-400 flex-1">{error}</p>
                <button onClick={() => setError(null)}>
                  <X className="w-5 h-5 text-red-400" />
                </button>
              </div>
            )}

            {/* Balance Card */}
            <div className="bg-gradient-to-br from-pink-500 to-purple-600 rounded-xl shadow-lg shadow-pink-500/20 p-4 md:p-8 mb-6 md:mb-8 text-white">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="w-5 h-5 md:w-6 md:h-6" />
                    <h2 className="text-base md:text-lg font-medium opacity-90">当前余额</h2>
                  </div>
                  <p className="text-3xl md:text-5xl font-bold">
                    {loading ? '...' : `${balance}`}
                    <span className="text-lg ml-2 opacity-75">积分</span>
                  </p>
                  <p className="text-xs md:text-sm opacity-75 mt-2">可用于AI模型使用</p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-xs md:text-sm opacity-75">新用户赠送</p>
                  <p className="text-xl md:text-2xl font-bold">200 积分</p>
                </div>
              </div>
            </div>

            {/* Purchase Packages */}
            <div className="bg-[#16161a] border border-gray-800/50 rounded-xl mb-6 md:mb-8">
              <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-800/50">
                <h2 className="text-lg md:text-xl font-bold text-gray-100">💳 积分套餐</h2>
                <p className="text-xs md:text-sm text-gray-500">选择套餐，使用支付宝支付</p>
              </div>
              
              <div className="p-4 md:p-6">
                {packagesLoading ? (
                  <div className="text-center py-8">
                    <div className="inline-block w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-gray-500 mt-4">加载套餐中...</p>
                  </div>
                ) : packages.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    暂无可用套餐
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6">
                    {packages.map((pkg) => {
                      const discount = getDiscountPercentage(pkg)
                      const BadgeIcon = pkg.badge ? BADGE_ICONS[pkg.badge] : null
                      const badgeColor = pkg.badge ? BADGE_COLORS[pkg.badge] : 'bg-gray-500'

                      return (
                        <motion.div
                          key={pkg.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          whileHover={{ y: -4 }}
                          className="relative bg-[#1a1a1f] rounded-2xl border border-gray-800/50 hover:border-pink-500/50 p-6 transition-all shadow-sm hover:shadow-xl hover:shadow-pink-500/10"
                        >
                          {/* Badge */}
                          {pkg.badge && BadgeIcon && (
                            <div className={`absolute -top-3 -right-3 ${badgeColor} text-white px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1 shadow-lg`}>
                              <BadgeIcon className="w-4 h-4" />
                              {pkg.badge}
                            </div>
                          )}

                          {/* Discount Tag */}
                          {discount && (
                            <div className="absolute top-3 left-3 bg-gradient-to-r from-red-500 to-pink-500 text-white px-2 py-1 rounded-md text-xs font-bold">
                              {discount}% OFF
                            </div>
                          )}

                          <div className="text-center">
                            {/* Credits */}
                            <div className="mb-4">
                              <div className="text-4xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                                {pkg.credits}
                              </div>
                              <div className="text-gray-500 text-sm mt-1">积分</div>
                            </div>

                            {/* Name */}
                            <h3 className="text-lg font-bold text-gray-100 mb-2">{pkg.name}</h3>

                            {/* Description */}
                            {pkg.description && (
                              <p className="text-gray-400 text-sm mb-4">{pkg.description}</p>
                            )}

                            {/* Price */}
                            <div className="mb-4">
                              <div className="flex items-center justify-center gap-2">
                                <span className="text-2xl font-bold text-gray-100">
                                  ¥{Number(pkg.price).toFixed(2)}
                                </span>
                                {pkg.original_price && Number(pkg.original_price) > Number(pkg.price) && (
                                  <span className="text-sm text-gray-500 line-through">
                                    ¥{Number(pkg.original_price).toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Buy Button */}
                            <button
                              onClick={() => handlePurchase(pkg)}
                              disabled={purchaseLoading}
                              className="w-full px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-lg hover:shadow-lg hover:shadow-pink-500/20 disabled:opacity-50 font-medium transition-all flex items-center justify-center gap-2"
                            >
                              <ShoppingCart className="w-4 h-4" />
                              立即购买
                            </button>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Pricing Information */}
            <div className="bg-[#16161a] border border-gray-800/50 rounded-xl">
              <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-800/50">
                <h2 className="text-lg md:text-xl font-bold text-gray-100 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                  模型积分价格
                </h2>
                <p className="text-xs md:text-sm text-gray-500">各种AI模型的积分消耗明细</p>
              </div>

              <div className="p-4 md:p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                  {/* 图片生成 */}
                  <div className="border border-gray-800/50 rounded-lg p-4 bg-[#1a1a1f]">
                    <h3 className="text-base md:text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 16m-6-16V4m0 0L12 2m0 2l2 2" />
                      </svg>
                      图片生成
                    </h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between">
                        <span className="text-gray-400">Wan 2.7 图像</span>
                        <span className="font-medium text-gray-200">50积分/张</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">Wan 2.7 Pro</span>
                        <span className="font-medium text-gray-200">80积分/张</span>
                      </li>
                    </ul>
                  </div>

                  {/* 视频生成 */}
                  <div className="border border-gray-800/50 rounded-lg p-4 bg-[#1a1a1f]">
                    <h3 className="text-base md:text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      视频生成
                    </h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between">
                        <span className="text-gray-400">HappyHorse (4秒)</span>
                        <span className="font-medium text-gray-200">120积分/视频</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">HappyHorse (8秒)</span>
                        <span className="font-medium text-gray-200">200积分/视频</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">Seedance (5-10秒)</span>
                        <span className="font-medium text-gray-200">150-240积分/视频</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-500">海螺 Hailuo (即将上线)</span>
                        <span className="font-medium text-gray-500">150积分/视频</span>
                      </li>
                    </ul>
                  </div>

                  {/* AI特效 */}
                  <div className="border border-gray-800/50 rounded-lg p-4 bg-[#1a1a1f]">
                    <h3 className="text-base md:text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                      AI特效
                    </h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between">
                        <span className="text-gray-400">去背景</span>
                        <span className="font-medium text-gray-200">20积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">人脸修复</span>
                        <span className="font-medium text-gray-200">30积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">动漫/吉卜力风格</span>
                        <span className="font-medium text-gray-200">40积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">超分辨率 4x/8x</span>
                        <span className="font-medium text-gray-200">50-80积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">AI挤压/融化/爆炸</span>
                        <span className="font-medium text-gray-200">60-80积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">换脸/AI亲吻/拥抱</span>
                        <span className="font-medium text-gray-200">80-100积分/次</span>
                      </li>
                    </ul>
                  </div>

                  {/* AI短视频 */}
                  <div className="border border-gray-800/50 rounded-lg p-4 bg-[#1a1a1f]">
                    <h3 className="text-base md:text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                      </svg>
                      AI短视频
                    </h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between">
                        <span className="text-gray-400">Seedance 短剧</span>
                        <span className="font-medium text-gray-200">150积分/场景</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">海螺 Hailuo</span>
                        <span className="font-medium text-gray-200">100积分/场景</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">HappyHorse</span>
                        <span className="font-medium text-gray-200">120积分/场景</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">Stable Video Diffusion</span>
                        <span className="font-medium text-gray-200">60积分/场景</span>
                      </li>
                    </ul>
                  </div>

                  {/* 动作模仿 */}
                  <div className="border border-gray-800/50 rounded-lg p-4 bg-[#1a1a1f]">
                    <h3 className="text-base md:text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      动作模仿
                    </h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between">
                        <span className="text-gray-400">Kling 2.6 动作控制</span>
                        <span className="font-medium text-gray-200">150积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">Wan 2.5 动画混合</span>
                        <span className="font-medium text-gray-200">120积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">Wan 2.2 动画</span>
                        <span className="font-medium text-gray-200">100积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">Hailuo Motion</span>
                        <span className="font-medium text-gray-200">80积分/次</span>
                      </li>
                    </ul>
                  </div>

                  {/* 视频编辑 */}
                  <div className="border border-gray-800/50 rounded-lg p-4 bg-[#1a1a1f]">
                    <h3 className="text-base md:text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                      视频编辑
                    </h3>
                    <ul className="space-y-2 text-sm">
                      <li className="flex justify-between">
                        <span className="text-gray-400">基础编辑（背景/天气）</span>
                        <span className="font-medium text-gray-200">60积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">风格转换（动漫/电影）</span>
                        <span className="font-medium text-gray-200">80积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400">人物变换（变年轻/换装）</span>
                        <span className="font-medium text-gray-200">100积分/次</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-gray-400 flex items-center gap-1">一键发布抖音 <span className="px-1.5 py-0.5 bg-pink-500/20 text-pink-400 text-[10px] rounded">New</span></span>
                        <span className="font-medium text-green-400">免费</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && currentOrder && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#16161a] border border-gray-800/50 rounded-2xl shadow-2xl max-w-lg w-full p-8 relative"
          >
            <button
              onClick={closePaymentModal}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-200"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-100 mb-4">扫码支付</h2>

              {/* Order Info */}
              <div className="bg-[#1a1a1f] border border-gray-800/50 rounded-lg p-4 mb-6 text-left">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">套餐：</span>
                  <span className="font-medium text-gray-200">{currentOrder.package_name}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">积分：</span>
                  <span className="font-medium text-gray-200">{currentOrder.credits} 积分</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">金额：</span>
                  <span className="font-bold text-lg text-pink-400">
                    ¥{Number(currentOrder.amount).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* QR Code */}
              {currentOrder.qr_code ? (
                <div className="mb-6">
                  <div className="bg-white p-4 rounded-lg inline-block">
                    <QRCodeSVG
                      value={currentOrder.qr_code}
                      size={256}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                  <p className="text-sm text-gray-400 mt-4">
                    请使用支付宝扫描二维码完成支付
                  </p>
                </div>
              ) : (
                <div className="mb-6 p-8 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
                  <p className="text-red-400">{currentOrder.error_message || '创建支付二维码失败'}</p>
                </div>
              )}

              {/* Status */}
              <div className="flex items-center justify-center gap-2 text-pink-400">
                <Clock className="w-5 h-5 animate-spin" />
                <span>等待支付中...</span>
              </div>

              <p className="text-xs text-gray-500 mt-4">
                订单号：{currentOrder.order_no}
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
