import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { ShoppingCart, Check, Clock, AlertCircle, X, Zap, Crown, Star, Gem } from 'lucide-react';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import { paymentService } from '../services/payment.service';
import type { CreditPackage, PaymentOrder } from '../types/payment.types';

const BADGE_COLORS: Record<string, string> = {
  '热门': 'bg-red-500',
  '推荐': 'bg-blue-500',
  '超值': 'bg-green-500',
  '限时': 'bg-purple-500',
};

const BADGE_ICONS: Record<string, React.ElementType> = {
  '热门': Star,
  '推荐': Crown,
  '超值': Zap,
  '限时': Clock,
};

export default function Recharge() {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [currentOrder, setCurrentOrder] = useState<PaymentOrder | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadPackages();
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, []);

  const loadPackages = async () => {
    try {
      const data = await paymentService.getPackages();
      setPackages(data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载套餐失败');
    }
  };

  const handlePurchase = async (pkg: CreditPackage) => {
    setSelectedPackage(pkg);
    setLoading(true);
    setError(null);

    try {
      const order = await paymentService.createOrder({
        package_id: pkg.id,
        payment_method: 'ALIPAY',
      });

      setCurrentOrder(order);
      setShowPaymentModal(true);

      // 开始轮询订单状态
      startPollingOrderStatus(order.order_no);
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建订单失败');
    } finally {
      setLoading(false);
    }
  };

  const startPollingOrderStatus = (orderNo: string) => {
    // 每3秒查询一次订单状态
    const interval = setInterval(async () => {
      try {
        const result = await paymentService.queryOrder(orderNo);

        if (result.order.status === 'SUCCESS') {
          // 支付成功
          clearInterval(interval);
          setPollingInterval(null);
          setShowPaymentModal(false);
          alert('支付成功！积分已充值到账。');
          // 跳回发起充值的页面(?redirect=),否则留在本页刷新更新积分。
          // 只接受站内绝对路径,避免开放重定向。用整页跳转确保各处积分余额刷新。
          const redirect = new URLSearchParams(window.location.search).get('redirect');
          if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
            window.location.href = redirect;
          } else {
            window.location.reload();
          }
        } else if (result.order.status === 'FAILED' || result.order.status === 'CANCELLED') {
          // 支付失败或取消
          clearInterval(interval);
          setPollingInterval(null);
          setError(result.order.error_message || '支付失败');
        } else if (result.is_expired) {
          // 订单过期
          clearInterval(interval);
          setPollingInterval(null);
          setError('订单已过期，请重新下单');
        }

        // 更新订单状态
        setCurrentOrder(result.order);
      } catch (err) {
        console.error('Failed to poll order status:', err);
      }
    }, 3000);

    setPollingInterval(interval);
  };

  const closePaymentModal = () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
    setShowPaymentModal(false);
    setCurrentOrder(null);
  };

  const getDiscountPercentage = (pkg: CreditPackage): number | null => {
    if (pkg.original_price && Number(pkg.original_price) > Number(pkg.price)) {
      return Math.round((1 - Number(pkg.price) / Number(pkg.original_price)) * 100);
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header />
      <div className="flex h-[calc(100vh-64px)]">
        <Sidebar />

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-100 mb-2 flex items-center gap-3">
                <Gem className="w-8 h-8 text-pink-500" strokeWidth={1.5} />
                Credit Recharge
              </h1>
              <p className="text-gray-400">Choose a package to power your AI creative journey</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <span className="text-red-400">{error}</span>
                <button onClick={() => setError(null)} className="ml-auto">
                  <X className="w-5 h-5 text-red-400" />
                </button>
              </div>
            )}

            {/* Packages Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {packages.map((pkg) => {
                const discount = getDiscountPercentage(pkg);
                const BadgeIcon = pkg.badge ? BADGE_ICONS[pkg.badge] : null;
                const badgeColor = pkg.badge ? BADGE_COLORS[pkg.badge] : 'bg-gray-500';

                return (
                  <motion.div
                    key={pkg.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -4 }}
                    className="relative bg-[#16161a] rounded-2xl border border-gray-800/50 hover:border-pink-500/50 p-6 transition-all hover:shadow-xl hover:shadow-pink-500/10"
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
                        <div className="text-5xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                          {pkg.credits}
                        </div>
                        <div className="text-gray-500 text-sm mt-1">Credits</div>
                      </div>

                      {/* Name */}
                      <h3 className="text-xl font-bold text-gray-100 mb-2">{pkg.name}</h3>

                      {/* Description */}
                      {pkg.description && (
                        <p className="text-gray-400 text-sm mb-4">{pkg.description}</p>
                      )}

                      {/* Price */}
                      <div className="mb-6">
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-3xl font-bold text-gray-100">
                            ¥{Number(pkg.price).toFixed(2)}
                          </span>
                          {pkg.original_price && (
                            <span className="text-lg text-gray-500 line-through">
                              ¥{Number(pkg.original_price).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Buy Button */}
                      <button
                        onClick={() => handlePurchase(pkg)}
                        disabled={loading}
                        className="w-full px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl hover:shadow-lg hover:shadow-pink-500/20 disabled:opacity-50 font-medium transition-all flex items-center justify-center gap-2"
                      >
                        <ShoppingCart className="w-5 h-5" />
                        Buy Now
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
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
              <h2 className="text-2xl font-bold text-gray-100 mb-4">Scan to Pay</h2>

              {/* Order Info */}
              <div className="bg-[#1a1a1f] border border-gray-800/50 rounded-lg p-4 mb-6 text-left">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Package:</span>
                  <span className="font-medium text-gray-200">{currentOrder.package_name}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-400">Credits:</span>
                  <span className="font-medium text-gray-200">{currentOrder.credits}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Amount:</span>
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
                    Scan QR code with Alipay to complete payment
                  </p>
                </div>
              ) : (
                <div className="mb-6 p-8 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
                  <p className="text-red-400">{currentOrder.error_message || 'Failed to create payment QR code'}</p>
                </div>
              )}

              {/* Status */}
              <div className="flex items-center justify-center gap-2 text-pink-400">
                <Clock className="w-5 h-5 animate-spin" />
                <span>Waiting for payment...</span>
              </div>

              <p className="text-xs text-gray-500 mt-4">
                Order: {currentOrder.order_no}
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
