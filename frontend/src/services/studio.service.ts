import { apiClient } from './api'

/**
 * Media Studio 服务:视频生成视频 / AI特效 / AI短视频 / 动作模仿 / 视频编辑。
 * 后端统一前缀 /api/v1/studio,任务异步轮询,结果落 MinIO 并进作品画廊。
 */

export type StudioTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface StudioTask {
  task_id: string
  status: StudioTaskStatus
  message: string
  result_url?: string
  error?: string
  progress?: number
}

export interface StudioHistoryItem {
  task_id: string
  prompt: string
  model_id: string
  result_url: string
  parameters: Record<string, any>
  created_at: string
}

export interface UploadResult {
  file_id: string
  filename: string
  kind: 'image' | 'video'
}

export type StudioFeature = 'effect' | 'short_video' | 'video2video' | 'motion' | 'video_edit'

async function post<T = StudioTask>(path: string, body: any): Promise<T> {
  const res = await apiClient.post<{ data: T }>(`/api/v1/studio/${path}`, body)
  return res.data.data
}

export const studioService = {
  /** 上传图片或视频,返回 file_id 供各功能引用 */
  async upload(file: File): Promise<UploadResult> {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post<{ data: { file_id: string; filename: string; message: string } }>(
      '/api/v1/studio/upload',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
    const d = res.data.data
    return { file_id: d.file_id, filename: d.filename, kind: (d.message as 'image' | 'video') }
  },

  createEffect(body: { effect_id: string; image_id: string; reference_image_id?: string; prompt?: string }) {
    return post('effects', body)
  },
  createShortVideo(body: { prompt: string; first_frame_id?: string; duration?: number; resolution?: string }) {
    return post('short-video', body)
  },
  createVideo2Video(body: {
    prompt: string
    video_id: string
    style_id?: string
    style_prompt?: string
    reference_image_ids?: string[]
    negative_prompt?: string
    ratio?: string
    duration?: number
    output_count?: number
    model_id?: string
    strength?: number
  }) {
    return post('video2video', body)
  },
  createMotion(body: {
    prompt?: string
    character_image_id: string
    motion_video_id?: string
    motion_template?: string
    model_id?: string
    character_orientation?: string
    keep_original_sound?: string
    ratio?: string
    duration?: number
  }) {
    return post('motion', body)
  },
  createVideoEdit(body: { prompt: string; video_id: string; edit_type?: string; ratio?: string; duration?: number }) {
    return post('video-edit', body)
  },

  async getTaskStatus(taskId: string): Promise<StudioTask> {
    const res = await apiClient.get<{ data: StudioTask }>(`/api/v1/studio/task/${taskId}`)
    return res.data.data
  },

  /** 轮询直到完成/失败 */
  async pollTask(
    taskId: string,
    onProgress?: (progress: number, status: string) => void,
    maxAttempts = 240,
    interval = 2500
  ): Promise<StudioTask> {
    let attempts = 0
    while (attempts < maxAttempts) {
      const task = await this.getTaskStatus(taskId)
      onProgress?.(task.progress || 0, task.status)
      const s = (task.status || '').toLowerCase().trim()
      if (s === 'completed' || s === 'failed') return task
      await new Promise((r) => setTimeout(r, interval))
      attempts++
    }
    throw new Error('任务轮询超时')
  },

  async getHistory(taskType: StudioFeature, limit = 20): Promise<StudioHistoryItem[]> {
    const res = await apiClient.get<{ data: StudioHistoryItem[] }>(
      `/api/v1/studio/history?task_type=${taskType}&limit=${limit}`
    )
    return res.data.data
  },

  getResultUrl(path: string | null | undefined): string {
    if (!path) return ''
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    const baseUrl = import.meta.env.VITE_API_URL || ''
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  },
}
