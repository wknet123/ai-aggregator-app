import { create } from 'zustand'
import type { Credit } from '../types/credit.types'
import { creditService } from '../services/credit.service'

interface CreditState {
  credit: Credit | null
  balance: number
  setCredit: (credit: Credit) => void
  setBalance: (balance: number) => void
  updateBalance: (amount: number) => void
  fetchBalance: () => Promise<void>
}

export const useCreditStore = create<CreditState>((set) => ({
  credit: null,
  balance: 0,

  setCredit: (credit: Credit) => {
    const numericBalance = typeof credit.balance === 'number' 
      ? credit.balance 
      : parseFloat(String(credit.balance)) || 0
    set({ credit, balance: numericBalance })
  },

  setBalance: (balance: number) => {
    set({ balance })
  },

  updateBalance: (amount: number) => {
    set((state) => ({ balance: state.balance + amount }))
  },

  fetchBalance: async () => {
    try {
      const credit = await creditService.getBalance()
      const numericBalance = typeof credit.balance === 'number'
        ? credit.balance
        : parseFloat(String(credit.balance)) || 0
      set({ balance: numericBalance })
    } catch (error) {
      console.error('Failed to fetch balance:', error)
    }
  },
}))
