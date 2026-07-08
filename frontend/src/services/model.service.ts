import { apiClient } from './api'
import type {
  ModelProvider,
  ModelPricing,
  ImageGenerationRequest,
} from '../types/model.types'

interface ApiResponse<T> {
  success: boolean
  message: string
  data: T
}

interface VideoGenerationRequest {
  prompt: string
  model: string
  duration?: number
  resolution?: string
  fps?: number
}

export const modelService = {
  async getAvailableModels(): Promise<ModelProvider[]> {
    const response = await apiClient.get<ApiResponse<ModelProvider[]>>(
      '/api/v1/models/list'
    )
    return response.data.data
  },

  async getPricing(): Promise<Record<string, ModelPricing>> {
    const response = await apiClient.get<ApiResponse<Record<string, ModelPricing>>>(
      '/api/v1/models/pricing'
    )
    return response.data.data
  },

  // OpenAI Image Generation
  async generateImage(data: ImageGenerationRequest): Promise<any> {
    const response = await apiClient.post<ApiResponse<any>>(
      '/api/v1/openai/image',
      data
    )
    return response.data.data
  },

  // OpenAI Video Generation (Sora)
  async generateVideo(data: VideoGenerationRequest): Promise<any> {
    const response = await apiClient.post<ApiResponse<any>>(
      '/api/v1/openai/video',
      data
    )
    return response.data.data
  },
}
