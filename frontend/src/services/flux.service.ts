import { apiClient } from './api'

export interface FluxGenerationTask {
  prompt: string
  model_id: string
  aspect_ratio?: string
  output_format?: string
  reference_image_id?: string
  drama_project_id?: string
}

export interface FluxTaskResponse {
  task_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  message: string
  result_url?: string
  error?: string
  progress?: number
}

export interface FluxHistoryItem {
  task_id: string
  prompt: string
  model_id: string
  result_url: string
  parameters: Record<string, any>
  created_at: string
}

export const fluxService = {
  /**
   * Start image generation task with Flux Kontext
   */
  async generateImage(task: FluxGenerationTask): Promise<FluxTaskResponse> {
    const response = await apiClient.post<{ data: FluxTaskResponse }>(
      '/api/v1/flux/generate-image',
      task
    )
    return response.data.data
  },

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<FluxTaskResponse> {
    const response = await apiClient.get<{ data: FluxTaskResponse }>(
      `/api/v1/flux/task/${taskId}`
    )
    return response.data.data
  },

  /**
   * Poll task until completion (with timeout)
   */
  async pollTaskStatus(
    taskId: string,
    onProgress?: (progress: number, status: string) => void,
    maxAttempts = 120, // 2 minutes (1s intervals)
    interval = 1000 // 1 second
  ): Promise<FluxTaskResponse> {
    let attempts = 0
    
    while (attempts < maxAttempts) {
      const task = await this.getTaskStatus(taskId)
      
      console.log(`[Flux pollTaskStatus] Task ${taskId}: status="${task.status}", progress=${task.progress}, result_url=${task.result_url}`)
      
      if (onProgress) {
        onProgress(task.progress || 0, task.status)
      }
      
      // Check for completion
      const statusLower = (task.status || '').toLowerCase().trim()
      const isCompleted = statusLower === 'completed' || (task.progress === 100 && task.result_url)
      const isFailed = statusLower === 'failed'
      
      if (isCompleted || isFailed) {
        console.log(`[Flux pollTaskStatus] Task ${taskId}: Final status="${task.status}"`)
        // Normalize status for downstream processing
        if (isCompleted) {
          task.status = 'completed'
        } else if (isFailed) {
          task.status = 'failed'
        }
        return task
      }
      
      await new Promise(resolve => setTimeout(resolve, interval))
      attempts++
    }
    
    throw new Error('Task polling timeout')
  },

  /**
   * Get user's Flux generation history
   */
  async getHistory(limit: number = 20): Promise<FluxHistoryItem[]> {
    const params = new URLSearchParams()
    params.append('task_type', 'image')
    params.append('limit', limit.toString())
    
    const response = await apiClient.get<{ data: FluxHistoryItem[] }>(
      `/api/v1/flux/history?${params.toString()}`
    )
    return response.data.data
  },

  /**
   * Get full URL for result
   */
  getResultUrl(path: string | null | undefined): string {
    if (!path) {
      return ''
    }
    // If already an absolute URL, return as-is
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path
    }
    // Build full URL from API base
    const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
    // Remove leading slash if present to avoid double slashes
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    return `${baseUrl}${cleanPath}`
  }
}
