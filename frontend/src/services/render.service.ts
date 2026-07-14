/**
 * Render Pipeline Service
 * Manages chained video generation across storyboard shots.
 */
import { apiClient } from './api'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ShotBeatInput {
  time: string
  action: string
  sfx?: string
  voice?: string
  imageRef?: number
  shotSize?: string              // 景别：closeup/wide/extreme/standard
}

/** 有序参考图：kind = 首尾帧图(frame) | 插图(illustration)。 */
export interface ShotImageInput {
  key: string
  name?: string
  kind?: 'frame' | 'illustration'
  label?: string
  frame?: 'first' | 'last'       // 首尾帧指定（提示词标注）
  usage?: string                 // 用途/视角（全局图片代入「全程使用图片N…」）
  desc?: string                  // 形态/特征描述（配置元素 description，代入「形象特征」行）
  assetType?: 'character' | 'scene' | 'prop'  // 来源类型：角色图确保提示词带角色名
}

export interface ShotInput {
  id: string
  index: number
  duration: number
  aspect_ratio?: string
  global_desc?: string
  unify_voice?: boolean
  generate_audio?: boolean
  // ── 整集级全局选项（按集汇入每镜） ──
  composition?: string
  narration?: string
  bgm_label?: string
  // ── 时间段分镜（Seedance 2.0）：每镜必填 ──
  beats: ShotBeatInput[]
  // ── 有序参考图（角色/参考图）：每镜至少 1 张，对应 图片1..N ──
  images: ShotImageInput[]
  reference_video_key?: string   // 视频1（单条可选）
  reference_video_label?: string  // 在剧创提示词中代入的名称
  audio_key?: string             // 音频1（单条可选）
  audio_label?: string            // 在剧创提示词中代入的名称
}

export interface ShotTaskStatus {
  shot_index: number
  shot_id: string
  task_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  seed: number
  progress: number
  result_url: string | null
  error: string | null
}

export interface PipelineStatus {
  pipeline_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial'
  total_shots: number
  completed_shots: number
  failed_shots: number
  shot_tasks: ShotTaskStatus[]
  composite_url: string | null
}

export interface StartPipelineResponse {
  pipeline_id: string
  total_shots: number
  shot_tasks: ShotTaskStatus[]
}

// ── Service ────────────────────────────────────────────────────────────────

export const renderService = {
  async startPipeline(
    shots: ShotInput[],
    modelId = 'kling-v1',
    aspectRatio = '16:9',
    opts?: { dramaProjectId?: string; episode?: number; compose?: boolean },
  ): Promise<StartPipelineResponse> {
    const resp = await apiClient.post<{ data: StartPipelineResponse }>(
      '/api/v1/render/pipeline',
      {
        shots,
        model_id: modelId,
        aspect_ratio: aspectRatio,
        drama_project_id: opts?.dramaProjectId,
        episode: opts?.episode,
        compose: opts?.compose ?? true,
      },
    )
    return resp.data.data
  },

  async getPipelineStatus(pipelineId: string): Promise<PipelineStatus> {
    const resp = await apiClient.get<{ data: PipelineStatus }>(
      `/api/v1/render/pipeline/${pipelineId}`,
    )
    return resp.data.data
  },

  async retryShotWithNewSeed(
    pipelineId: string,
    shotIndex: number,
    seedOffset = 1,
  ): Promise<{ task_id: string; seed: number }> {
    const resp = await apiClient.post<{ data: { task_id: string; seed: number } }>(
      `/api/v1/render/pipeline/${pipelineId}/shots/${shotIndex}/retry`,
      { seed_offset: seedOffset },
    )
    return resp.data.data
  },

  /**
   * Poll pipeline status until all shots are done (completed, failed, or partial).
   * Calls onUpdate on every poll tick so UI can refresh reactively.
   *
   * 轮询窗口必须 ≥ 后端生成上限：单镜 Seedance 后端给到 180×10s=30min，再加成片拼接，
   * 因此默认 3s×700≈35min。早期 5min 封顶会在后端尚未完成时就 timeout，
   * 导致界面冻结在「生成中」、成片产出后也接不回来。
   */
  async pollPipeline(
    pipelineId: string,
    onUpdate: (status: PipelineStatus) => void,
    intervalMs = 3000,
    maxAttempts = 700,
  ): Promise<PipelineStatus> {
    let attempts = 0
    while (attempts < maxAttempts) {
      const status = await this.getPipelineStatus(pipelineId)
      onUpdate(status)

      if (['completed', 'failed', 'partial'].includes(status.status)) {
        return status
      }

      await new Promise((r) => setTimeout(r, intervalMs))
      attempts++
    }
    throw new Error('Pipeline polling timeout')
  },
}
