import { apiClient } from './api'

export interface DouyinConnection {
  connected: boolean
  nickname?: string
  open_id?: string
  error?: string
}

export interface DouyinPublishRequest {
  task_id: string
  title: string
  cover_tsp?: number
}

export interface DouyinPublishStatus {
  status: 'pending' | 'uploading' | 'publishing' | 'completed' | 'failed'
  step: number
  error: string | null
  item_id: string | null
}

export const douyinService = {
  async getConnection(): Promise<DouyinConnection> {
    const response = await apiClient.get<{ data: DouyinConnection }>('/api/v1/douyin/connection')
    return response.data.data
  },

  async getAuthUrl(): Promise<string> {
    const response = await apiClient.get<{ data: { auth_url: string } }>('/api/v1/douyin/auth-url')
    return response.data.data.auth_url
  },

  async handleCallback(code: string, state: string): Promise<{ success: boolean; open_id: string }> {
    const response = await apiClient.post<{ data: { success: boolean; open_id: string } }>(
      '/api/v1/douyin/callback',
      { code, state }
    )
    return response.data.data
  },

  async disconnect(): Promise<void> {
    await apiClient.delete('/api/v1/douyin/connection')
  },

  async publish(request: DouyinPublishRequest): Promise<{ publish_id: string; status: string }> {
    const response = await apiClient.post<{ data: { publish_id: string; status: string } }>(
      '/api/v1/douyin/publish',
      request
    )
    return response.data.data
  },

  async getPublishStatus(publishId: string): Promise<DouyinPublishStatus> {
    const response = await apiClient.get<{ data: DouyinPublishStatus }>(
      `/api/v1/douyin/publish/${publishId}`
    )
    return response.data.data
  },

  async pollPublishStatus(
    publishId: string,
    onProgress?: (status: DouyinPublishStatus) => void,
    maxAttempts = 60,
    interval = 3000
  ): Promise<DouyinPublishStatus> {
    let attempts = 0

    while (attempts < maxAttempts) {
      const status = await this.getPublishStatus(publishId)

      if (onProgress) {
        onProgress(status)
      }

      if (status.status === 'completed' || status.status === 'failed') {
        return status
      }

      await new Promise(resolve => setTimeout(resolve, interval))
      attempts++
    }

    throw new Error('Publish polling timeout')
  },
}
