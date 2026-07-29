import { apiClient } from './api'

export interface FileUploadResponse {
  success: boolean
  file_id: string
  filename: string
  file_path: string
  message?: string
}

export interface GenerationTask {
  prompt: string
  model_id: string
  aspect_ratio?: string
  resolution?: string
  duration?: number
  first_frame_id?: string
  second_frame_id?: string
  third_frame_id?: string
  reference_image_id?: string  // For image-to-image generation
  generation_mode?: string  // text-to-video, image-to-video, video-to-video, text-to-image, image-to-image
  drama_project_id?: string   // Route media to project-specific MinIO path
}

export interface GenerationTaskResponse {
  task_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  message: string
  result_url?: string
  error?: string
  progress?: number
}

/**
 * Parameters blob persisted alongside each generation task (server sends it back
 * verbatim on /history). Carries everything the editor needs to refill a form —
 * text params plus the client-side upload ids used to restore reference previews.
 * All fields optional: older tasks predate the *_id capture and only have text params.
 */
export interface GenerationParameters {
  aspect_ratio?: string
  resolution?: string
  duration?: number
  generation_mode?: string  // text-to-image | image-to-image | text-to-video | image-to-video
  reference_image_id?: string          // image-to-image reference
  first_frame_id?: string              // image-to-video frames
  second_frame_id?: string
  third_frame_id?: string
  [key: string]: any  // tolerate server-side resolved fields (reference_image_path, *_frame_path)
}

export interface HistoryItem {
  task_id: string
  prompt: string
  model_id: string
  task_type: string
  result_url: string
  parameters: GenerationParameters
  is_favorite?: boolean
  is_public?: boolean
  created_at?: string
}

export interface ShareLink {
  task_id: string
  exp: number
  sig: string
  expires_at: string
  is_public: boolean
}

export interface SharedWork {
  task_id: string
  task_type: string
  prompt: string
  model_id: string
  result_url: string
  created_at?: string
}

/**
 * Build a directly-loadable <img src> URL for a previously-uploaded reference frame.
 * The backend's GET /upload-frame/{id} accepts the JWT via ?token= so the browser can
 * fetch it without a custom Authorization header. Returns '' if no id/token.
 */
export function buildUploadPreviewUrl(fileId?: string | null): string {
  if (!fileId) return ''
  const token = localStorage.getItem('access_token') || ''
  const API_URL = import.meta.env.VITE_API_URL || ''
  return `${API_URL}/api/v1/google/upload-frame/${fileId}?token=${encodeURIComponent(token)}`
}

/**
 * Assemble the visitor-facing share URL from a signed link. Points at the
 * frontend origin so it works regardless of API host. The /share/:taskId route
 * is public (no auth) and reads exp/sig to fetch the shared work.
 */
export function buildShareUrl(taskId: string, exp: number, sig: string): string {
  return `${window.location.origin}/share/${taskId}?exp=${exp}&sig=${encodeURIComponent(sig)}`
}

export const googleService = {
  /**
   * Upload first frame image for video generation
   */
  async uploadFirstFrame(file: File): Promise<FileUploadResponse> {
    const formData = new FormData()
    formData.append('file', file)
    
    const response = await apiClient.post<{ data: FileUploadResponse }>(
      '/api/v1/google/upload-frame',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    )
    
    return response.data.data
  },

  /**
   * Start image generation task
   */
  async generateImage(task: GenerationTask): Promise<GenerationTaskResponse> {
    const response = await apiClient.post<{ data: GenerationTaskResponse }>(
      '/api/v1/google/generate-image',
      task
    )
    return response.data.data
  },

  /**
   * Start video generation task
   */
  async generateVideo(task: GenerationTask): Promise<GenerationTaskResponse> {
    const response = await apiClient.post<{ data: GenerationTaskResponse }>(
      '/api/v1/google/generate-video',
      task
    )
    return response.data.data
  },

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<GenerationTaskResponse> {
    const response = await apiClient.get<{ data: GenerationTaskResponse }>(
      `/api/v1/google/task/${taskId}`
    )
    return response.data.data
  },

  /**
   * Poll task until completion (with timeout)
   */
  async pollTaskStatus(
    taskId: string,
    onProgress?: (progress: number, status: string) => void,
    maxAttempts = 180, // 30 minutes (10s intervals)
    interval = 10000 // 10 seconds
  ): Promise<GenerationTaskResponse> {
    let attempts = 0
    
    while (attempts < maxAttempts) {
      const task = await this.getTaskStatus(taskId)
      
      console.log(`[pollTaskStatus] Task ${taskId}: status="${task.status}", progress=${task.progress}, result_url=${task.result_url}`)
      
      if (onProgress) {
        onProgress(task.progress || 0, task.status)
      }
      
      // Check for completion: either status is completed/failed, or progress=100 with result_url
      const statusLower = (task.status || '').toLowerCase().trim()
      const isCompleted = statusLower === 'completed' || (task.progress === 100 && task.result_url)
      const isFailed = statusLower === 'failed'
      
      if (isCompleted || isFailed) {
        console.log(`[pollTaskStatus] Task ${taskId}: Final status="${task.status}", isCompleted=${isCompleted}, isFailed=${isFailed}`)
        // Normalize status for downstream processing
        if (isCompleted) {
          task.status = 'completed'
        } else if (isFailed) {
          task.status = 'failed'
        } else {
          task.status = 'processing'
        }
        return task
      }
      
      await new Promise(resolve => setTimeout(resolve, interval))
      attempts++
    }
    
    throw new Error('Task polling timeout')
  },

  /**
   * Get user's generation history
   */
  async getHistory(taskType?: 'image' | 'video', limit: number = 20): Promise<HistoryItem[]> {
    const params = new URLSearchParams()
    if (taskType) params.append('task_type', taskType)
    params.append('limit', limit.toString())

    const response = await apiClient.get<{ data: HistoryItem[] }>(
      `/api/v1/google/history?${params.toString()}`
    )
    return response.data.data
  },

  /**
   * Get full URL for result
   */
  getResultUrl(path: string | null | undefined): string {
    // Handle null/undefined/empty path
    if (!path) {
      return ''
    }
    // If already an absolute URL, return as-is
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path
    }
    // Use VITE_API_URL if set, otherwise use current origin (for production)
    // This handles both dev (with proxy) and production (same origin) scenarios
    const API_URL = import.meta.env.VITE_API_URL || ''
    if (API_URL) {
      return `${API_URL}${path}`
    }
    // Use relative path - works with nginx proxy in production
    return path
  },

  /**
   * Delete a generation task
   */
  async deleteTask(taskId: string): Promise<void> {
    await apiClient.delete(`/api/v1/google/task/${taskId}`)
  },

  /**
   * Toggle favorite status for a task
   */
  async toggleFavorite(taskId: string): Promise<{ is_favorite: boolean }> {
    const response = await apiClient.post<{ data: { is_favorite: boolean } }>(
      `/api/v1/google/task/${taskId}/favorite`
    )
    return response.data.data
  },

  /**
   * Get user's favorite tasks
   */
  async getFavorites(taskType?: 'image' | 'video', limit: number = 50): Promise<any[]> {
    const params = new URLSearchParams()
    if (taskType) params.append('task_type', taskType)
    params.append('limit', limit.toString())

    const response = await apiClient.get<{ data: any[] }>(
      `/api/v1/google/favorites?${params.toString()}`
    )
    return response.data.data
  },

  /**
   * Get public works from all users (Discover)
   */
  async getPublicWorks(taskType?: 'image' | 'video', limit: number = 50): Promise<any[]> {
    const params = new URLSearchParams()
    if (taskType) params.append('task_type', taskType)
    params.append('limit', limit.toString())

    const response = await apiClient.get<{ data: any[] }>(
      `/api/v1/google/discover?${params.toString()}`
    )
    return response.data.data
  },

  /**
   * Toggle public status for a task
   */
  async togglePublic(taskId: string): Promise<{ is_public: boolean }> {
    const response = await apiClient.post<{ data: { is_public: boolean } }>(
      `/api/v1/google/task/${taskId}/public`
    )
    return response.data.data
  },

  /**
   * Create a signed, expiring share link for a completed work. Publishes the
   * work as a side effect (backend sets is_public=1). ttlDays ∈ {1, 7, 10}.
   */
  async createShareLink(taskId: string, ttlDays: number): Promise<ShareLink> {
    const response = await apiClient.post<{ data: ShareLink }>(
      `/api/v1/google/task/${taskId}/share`,
      { ttl_days: ttlDays }
    )
    return response.data.data
  },

  /**
   * Fetch public metadata for a shared work (visitor side, no auth). Uses raw
   * fetch to bypass apiClient's JWT interceptor / 401 auto-logout — visitors
   * have no token.
   */
  async getSharedWork(taskId: string, exp: string, sig: string): Promise<SharedWork> {
    const API_URL = import.meta.env.VITE_API_URL || ''
    const url = `${API_URL}/api/v1/google/share/${taskId}?exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`share_unavailable_${res.status}`)
    }
    const body = await res.json()
    return body.data as SharedWork
  }
}
