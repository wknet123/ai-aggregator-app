import { apiClient } from './api'
import type { Tenant } from '../types/tenant.types'

interface ApiResponse<T> {
  success: boolean
  message: string
  data: T
}

export const tenantService = {
  async getCurrentTenant(): Promise<Tenant> {
    const response = await apiClient.get<ApiResponse<Tenant>>(
      '/api/v1/tenants/current'
    )
    return response.data.data
  },
}
