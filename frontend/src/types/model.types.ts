/**
 * Model Types
 */

export type ModelCategory = 'image' | 'video' | '3d'

export interface ModelConfig {
  id: string
  name: string
  provider: string
  category: ModelCategory
  basePrice: number // Base price per generation
  options: ModelOption[]
  description?: string
  enabled?: boolean // Whether the model is currently available
  comingSoon?: boolean // Whether the model is coming soon
}

export interface ModelOption {
  key: string
  label: string
  type: 'select' | 'slider' | 'input' | 'toggle'
  default: any
  options?: Array<{ value: any; label: string; priceFactor?: number }>
  min?: number
  max?: number
  step?: number
  priceFactor?: number
  unit?: string
}

export interface GenerationConfig {
  modelId: string
  prompt: string
  options: Record<string, any>
}

export interface ModelProvider {
  provider: string
  models: string[]
}

export interface ModelPricing {
  [model: string]: {
    input?: number
    output?: number
    standard?: number
    hd?: number
    unit: string
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ImageGenerationRequest {
  prompt: string
  model: string
  size?: string
  quality?: string
}
