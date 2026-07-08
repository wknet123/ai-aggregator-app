import { apiClient } from './api'
import type { Credit, Transaction, RechargeRequest } from '../types/credit.types'

interface ApiResponse<T> {
  success: boolean
  message: string
  data: T
}

export const creditService = {
  async getBalance(): Promise<{ balance: number }> {
    const response = await apiClient.get<ApiResponse<{ balance: number }>>(
      '/api/v1/credits/balance'
    )
    return response.data.data
  },

  async getCreditInfo(): Promise<Credit> {
    const response = await apiClient.get<ApiResponse<Credit>>(
      '/api/v1/credits/info'
    )
    return response.data.data
  },

  async recharge(data: RechargeRequest): Promise<Transaction> {
    const response = await apiClient.post<ApiResponse<Transaction>>(
      '/api/v1/credits/recharge',
      data
    )
    return response.data.data
  },

  async getTransactions(skip = 0, limit = 100): Promise<Transaction[]> {
    const response = await apiClient.get<ApiResponse<Transaction[]>>(
      '/api/v1/credits/transactions',
      { params: { skip, limit } }
    )
    return response.data.data
  },
}
