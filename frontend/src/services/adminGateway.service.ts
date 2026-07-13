import { apiClient } from './api'
import type {
  GatewayConfig,
  GatewayConfigCreate,
  GatewayConfigUpdate,
  UserMapping,
} from '../types/gatewayConfig.types'

interface ApiResponse<T> {
  success: boolean
  message: string
  data: T
}

export const adminGatewayService = {
  async listConfigs(): Promise<GatewayConfig[]> {
    const res = await apiClient.get<ApiResponse<{ items: GatewayConfig[] }>>(
      '/api/v1/admin/gateway/configs'
    )
    return res.data.data.items
  },

  async createConfig(data: GatewayConfigCreate): Promise<GatewayConfig> {
    const res = await apiClient.post<ApiResponse<GatewayConfig>>(
      '/api/v1/admin/gateway/configs',
      data
    )
    return res.data.data
  },

  async updateConfig(id: number, data: GatewayConfigUpdate): Promise<GatewayConfig> {
    const res = await apiClient.put<ApiResponse<GatewayConfig>>(
      `/api/v1/admin/gateway/configs/${id}`,
      data
    )
    return res.data.data
  },

  async deleteConfig(id: number): Promise<void> {
    await apiClient.delete(`/api/v1/admin/gateway/configs/${id}`)
  },

  async setDefault(id: number): Promise<void> {
    await apiClient.post(`/api/v1/admin/gateway/configs/${id}/set-default`)
  },

  async listUserMappings(page = 1, pageSize = 50): Promise<{ items: UserMapping[]; total: number }> {
    const res = await apiClient.get<ApiResponse<{ items: UserMapping[]; total: number }>>(
      '/api/v1/admin/gateway/user-mappings',
      { params: { page, page_size: pageSize } }
    )
    return { items: res.data.data.items, total: res.data.data.total }
  },

  async setUserMapping(userId: number, gatewayConfigId: number | null): Promise<void> {
    await apiClient.put(`/api/v1/admin/gateway/user-mappings/${userId}`, {
      gateway_config_id: gatewayConfigId,
    })
  },
}
