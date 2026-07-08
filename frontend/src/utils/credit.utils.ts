/**
 * Credit Utils - 积分相关工具函数
 */
import { useCreditStore } from '../store/credit.store'

export const creditUtils = {
  /** 格式化积分显示 */
  formatCredits(credits: number): string {
    return `${Math.round(credits)}分`
  },

  /** 检查积分是否足够 */
  hasEnoughCredits(balance: number, required: number): boolean {
    return balance >= required
  },
}

/**
 * Hook：暴露与当前余额绑定的积分工具。
 *
 * 积分不足的提示与「去充值」跳转已统一由 <CreditErrorBanner> 内联展示
 * （点击进充值页、付款成功跳回原页），不再用 window.confirm 阻塞跳转，
 * 故这里只保留纯计算/格式化能力。
 */
export const useCreditUtils = () => {
  const { balance } = useCreditStore()

  return {
    formatCredits: creditUtils.formatCredits,
    hasEnoughCredits: (required: number) => creditUtils.hasEnoughCredits(balance, required),
  }
}
