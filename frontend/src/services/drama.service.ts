/**
 * AI Drama (AI短剧) Service
 * Orchestrates outline and storyboard generation via backend.
 * Stages 3 (image) and 4 (video) delegate to existing flux/google services.
 */
import { apiClient } from './api'

// ── Character Profile (角色统一卡) ────────────────────────────────────────────

export interface CharacterReferenceImage {
  fileId: string                 // upload-frame file_id
  displayUrl?: string            // runtime only, stripped before save
  angle: 'front' | 'side' | 'half-body' | 'full-body' | 'other'
  label?: string
}

export interface CharacterProfile {
  // 基础人设
  age: number
  personality: string[]          // e.g. ['倔强', '善良', '敏感']

  // 视觉特征
  facialFeatures: string         // 精确面部描述（脸型、五官、肤色等）
  symbolicFeatures?: string      // 标志性特征（疤痕、胎记、纹身等）
  clothing: string               // 全程统一服装描述
  accessories?: string           // 配饰描述
  figure: string                 // 身材体态

  // 情绪规则
  currentEmotion: string         // 当前默认情绪
  microExpression?: string       // 微表情描述

  // 多参考图（3-5张）
  referenceImages: CharacterReferenceImage[]
}

/** Build a unified text description from structured CharacterProfile fields */
export function buildCharacterDescription(profile: CharacterProfile, name: string): string {
  const parts: string[] = []
  if (profile.age) parts.push(`${profile.age}岁`)
  if (profile.figure) parts.push(profile.figure)
  if (profile.facialFeatures) parts.push(profile.facialFeatures)
  if (profile.symbolicFeatures) parts.push(profile.symbolicFeatures)
  if (profile.clothing) parts.push(`穿着${profile.clothing}`)
  if (profile.accessories) parts.push(`佩戴${profile.accessories}`)
  if (profile.personality?.length) parts.push(`性格${profile.personality.join('、')}`)
  if (profile.currentEmotion) parts.push(`当前情绪：${profile.currentEmotion}`)
  return parts.join('，')
}

// ── Material types ───────────────────────────────────────────────────────────

/** A character outfit / look variant (变装) — alternate appearance reusable across shots */
export interface MaterialVariant {
  id: string
  name: string                  // 变装名，如「礼服」「受伤造型」「校服」
  description: string           // 该造型的视觉描述（服装/发型/状态变化）
  referenceFileId?: string      // upload-frame file_id
  referenceImageUrl?: string    // runtime-only display URL, stripped before save
}

export interface MaterialItem {
  id: string                    // UUID, stable identifier for cross-referencing
  name: string
  description: string           // Visual description text (auto-compiled from characterProfile if present)
  referenceImageUrl?: string    // Display URL (runtime only, stripped before save)
  referenceFileId?: string      // file_id from /upload-frame (uploaded or history)
  generatedTaskId?: string      // task_id from Flux/Imagen AI generation
  sourceType?: 'upload' | 'ai-generated' | 'history' | 'none'
  locked?: boolean              // Locked characters persist across all episodes
  characterProfile?: CharacterProfile  // Structured character template (角色统一卡)
  character_id?: string         // Link to backend Character record for profile sync
  variants?: MaterialVariant[]  // 变装/造型 alternates (characters only)
}

/** @deprecated Use MaterialItem instead */
export interface MaterialCharacter {
  name: string
  description: string
  referenceImageUrl?: string
  referenceFileId?: string
}

/** @deprecated Use MaterialItem instead */
export interface MaterialScene {
  name: string
  description: string
  referenceImageUrl?: string
  referenceFileId?: string
}

export interface MaterialStyle {
  colorPalette: string       // e.g. "warm tones, golden hour lighting"
  visualStyle: string        // e.g. "cinematic realism, shallow depth of field"
  additionalNotes: string
}

export interface MaterialsData {
  characters: MaterialItem[]    // 角色
  sets: MaterialItem[]          // 布景 (backgrounds, environments)
  props: MaterialItem[]         // 辅助附件 (accessories, items)
  style: MaterialStyle
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CharacterItem {
  name: string
  description: string
}

export interface SceneItem {
  name: string
  description: string
}

export interface EpisodeOutline {
  episode: number
  title: string
  outline: string
  opening_hook: string
  ending_hook: string
  characters: CharacterItem[]
  scenes: SceneItem[]
  key_events: string[]
  emotional_curve: string
}

export interface OutlineResponse {
  genre: string
  art_style: string
  aspect_ratio: string
  episodes: EpisodeOutline[]
}

export interface ShotItem {
  index: number
  prompt: string        // English prompt for image generation
  prompt_cn: string     // Chinese description
  shot_type: string     // close-up | medium | wide | aerial | POV
  scene: string
  characters: string[]
  props: string[]             // prop names referenced in this shot
  duration_hint: string
  // Runtime state (not from API)
  image_task_id?: string
  image_url?: string    // result_path from MinIO / local
  video_task_id?: string
  video_url?: string
}

export interface StoryboardResponse {
  episode: number
  title: string
  shots: ShotItem[]
}

export interface OutlineRequest {
  concept: string
  genre: string
  art_style: string
  aspect_ratio: string
  episode_count: number
  materials_context?: string
}

export interface ParseScriptRequest {
  script_text: string
  genre: string
  art_style: string
  aspect_ratio: string
  episode_count: number   // 0 = auto-detect from script
  materials_context?: string
}

export interface StoryboardRequest {
  episode: EpisodeOutline
  art_style: string
  aspect_ratio: string
  shot_count: number
  materials_context?: string
}

// ── Project types ─────────────────────────────────────────────────────────────

// 重构核心：剧集系列数据。一个项目 = 一部短剧(系列)，含多集；每集有独立剧本 + 分镜。
export interface EpisodeShotBeat {
  time: string
  action: string
  sfx?: string
  voice?: string
  imageRef?: number          // 引用 图片N（1-indexed），与 images 顺序对应
  shotSize?: 'closeup' | 'wide' | 'extreme' | 'standard'  // 景别：近景/远景/特写/标准；standard/缺省=默认不强调
}

/** 有序参考图：kind = 首尾帧图(frame) | 插图(illustration)。
 *  frame 按顺序填 Seedance 首帧→尾帧（可只 1 张=仅首帧，可 0 张）；illustration 全进额外参考。 */
export interface EpisodeShotImage {
  key: string                // MinIO object key（pending 槽为空串，待用户上传填充）
  name?: string              // 文件名
  kind: 'frame' | 'illustration'
  label?: string             // 素材名称，用于剧创提示词代入
  frame?: 'first' | 'last'   // 首帧/尾帧指定（互斥，可清除），体现在最终提示词
  usage?: string             // 用途/视角（全局图片代入「全程使用图片N…」；分镜自有图片一般为空）
  desc?: string              // 形态/特征描述（来自配置元素 description，代入「形象特征」行，可手改）
  assetId?: string           // 来源配置元素 asset_id（从配置选取时标记，用于溯源/徽标）
  assetType?: 'character' | 'scene' | 'prop'  // 来源配置元素类型（角色/场景/道具）
  displayUrl?: string        // 运行时展示用，保存前剥离
  pending?: boolean          // 拆分时按文中「图片N」预建的空槽，尚未上传实图
}

export interface EpisodeShot {
  id: string
  index: number
  title?: string             // 分镜标题（可编辑，未命名用默认「分镜N」）
  duration: number
  global_desc?: string       // 本镜整体创意/视角（取代场景描述）
  unify_voice?: boolean
  generate_audio?: boolean
  beats: EpisodeShotBeat[]   // 时间段分镜（必填）
  images: EpisodeShotImage[] // 有序参考图（≥1）
  reference_video_key?: string
  reference_video_name?: string
  reference_video_label?: string   // 在剧创提示词中代入的名称
  audio_key?: string
  audio_name?: string
  audio_label?: string             // 在剧创提示词中代入的名称
  // ── 变更追踪：检测分镜修改后成片是否已过期，供步骤提示「有更新」 ──
  rendered_prompt?: string         // 生成本镜视频时实际使用的提示词快照；当前基线≠它 ⇒ 成片需重新生成
  // ── 运行时渲染状态 ──
  videoTaskId?: string
  videoUrl?: string
  videoStatus?: 'idle' | 'pending' | 'processing' | 'completed' | 'failed'
  videoError?: string
}

export interface SeriesWork {
  task_id: string
  title: string
  url: string                // /api/v1/google/task/{id}/file
  transition: 'none' | 'crossfade' | 'fade'
  episode_count: number
  created_at?: string | null
}

export interface DramaEpisode {
  episode: number
  title: string
  script_text: string        // 本集剧本（主线）
  global_desc?: string        // 整集共享创意描述（整体视角/风格，对应所有分镜，不落到单镜）
  // ── 整集级全局选项（关联素材库，按名称代入提示词） ──
  assets?: EpisodeAsset[]     // 整集素材库（图/视频/音频统一管理，供全局选项与分镜引用）
  composition?: string        // 构图视角（可填文字，或关联素材库某视频名）
  narration?: string          // 人称定义（第一人称/第三人称/旁白/自定义）
  bgm?: { key?: string; label?: string }  // 背景音乐，关联素材库某音频
  shots: EpisodeShot[]
  prompts_confirmed?: boolean // 「生成剧创提示词」步骤已确认
  pipeline_id?: string       // 最近一次渲染管线
  composite_url?: string     // 本集成片
}

/** 整集素材库一项：图/视频/音频统一，label 为提示词代入名称。
 *  图片(type='image') 额外携带与「分镜内上传图片」一致的选项（首尾帧 / 用途视角），
 *  并可作为全局参考图自动引用到本集所有分镜（applyToAll，缺省视为 true）。 */
export interface EpisodeAsset {
  id: string
  key: string                // MinIO object key
  name?: string              // 原始文件名
  label?: string             // 提示词代入名称（如：红苹果、手持运镜、欢快BGM）
  type: 'image' | 'video' | 'audio'
  // ── 仅 image：作为全局参考图引用进分镜时的选项 ──
  frame?: 'first' | 'last'   // 首帧/尾帧指定（与分镜内图片一致），体现在最终提示词
  usage?: string             // 用途/视角（如「第一视角构图」），代入「全程使用图片N…」一行
  desc?: string              // 形态/特征描述（来自配置元素 description，代入「形象特征」行）
  assetId?: string           // 来源配置元素 asset_id（从配置选取时标记）
  assetType?: 'character' | 'scene' | 'prop'  // 来源配置元素类型
  applyToAll?: boolean       // 是否自动引用到本集所有分镜（缺省/未定义视为 true）
}

export interface EpisodesData {
  episodes: DramaEpisode[]
}

export interface DramaProjectRecord {
  project_id: string
  name: string
  description?: string
  concept?: string
  genre?: string
  art_style?: string
  aspect_ratio?: string
  episode_count: number
  status: 'draft' | 'in_progress' | 'completed' | 'archived'
  archived_at?: string | null
  thumbnail_path?: string
  preview_images?: string[]
  created_at: string
  updated_at: string
  // Only populated in detail requests
  episodes_data?: EpisodesData | null
}

export interface ListProjectsParams {
  q?: string
  genre?: string
  status?: string
  archived?: boolean
  limit?: number
  offset?: number
}

export interface CreateProjectPayload {
  name: string
  description?: string
  concept?: string
  genre?: string
  art_style?: string
  aspect_ratio?: string
  episode_count?: number
}

export interface UpdateProjectPayload {
  name?: string
  description?: string
  concept?: string
  genre?: string
  art_style?: string
  aspect_ratio?: string
  episode_count?: number
  status?: string
  thumbnail_path?: string
  episodes_data?: EpisodesData | null
}

interface ProjectListResponse {
  items: DramaProjectRecord[]
  total: number
  limit: number
  offset: number
}

// ── Service ──────────────────────────────────────────────────────────────────

export const dramaService = {
  async generateOutline(req: OutlineRequest): Promise<OutlineResponse> {
    const resp = await apiClient.post<OutlineResponse>('/api/v1/drama/outline', req)
    return resp.data
  },

  async parseScript(req: ParseScriptRequest): Promise<OutlineResponse> {
    const resp = await apiClient.post<OutlineResponse>('/api/v1/drama/parse-script', req)
    return resp.data
  },

  async generateStoryboard(req: StoryboardRequest): Promise<StoryboardResponse> {
    const resp = await apiClient.post<StoryboardResponse>('/api/v1/drama/storyboard', req)
    return resp.data
  },

  // ── Project CRUD ────────────────────────────────────────────────────────────

  async listProjects(params: ListProjectsParams = {}): Promise<ProjectListResponse> {
    const p = new URLSearchParams()
    if (params.q)      p.append('q', params.q)
    if (params.genre)  p.append('genre', params.genre)
    if (params.status) p.append('status', params.status)
    if (params.archived) p.append('archived', 'true')
    if (params.limit)  p.append('limit', String(params.limit))
    if (params.offset) p.append('offset', String(params.offset))
    const resp = await apiClient.get<{ data: ProjectListResponse }>(
      `/api/v1/drama/projects?${p.toString()}`
    )
    return resp.data.data
  },

  async createProject(payload: CreateProjectPayload): Promise<DramaProjectRecord> {
    const resp = await apiClient.post<{ data: DramaProjectRecord }>('/api/v1/drama/projects', payload)
    return resp.data.data
  },

  async getProject(projectId: string): Promise<DramaProjectRecord> {
    const resp = await apiClient.get<{ data: DramaProjectRecord }>(`/api/v1/drama/projects/${projectId}`)
    return resp.data.data
  },

  async updateProject(projectId: string, payload: UpdateProjectPayload): Promise<DramaProjectRecord> {
    const resp = await apiClient.put<{ data: DramaProjectRecord }>(
      `/api/v1/drama/projects/${projectId}`,
      payload
    )
    return resp.data.data
  },

  async deleteProject(projectId: string): Promise<void> {
    await apiClient.delete(`/api/v1/drama/projects/${projectId}`)
  },

  async archiveProject(projectId: string): Promise<DramaProjectRecord> {
    const resp = await apiClient.post<{ data: DramaProjectRecord }>(`/api/v1/drama/projects/${projectId}/archive`)
    return resp.data.data
  },

  async unarchiveProject(projectId: string): Promise<DramaProjectRecord> {
    const resp = await apiClient.post<{ data: DramaProjectRecord }>(`/api/v1/drama/projects/${projectId}/unarchive`)
    return resp.data.data
  },

  // ── 逐分镜视频 (剧创式 → Seedance 2.0 多模态) ──────────────────────────

  async generateShotVideo(params: {
    drama_project_id: string
    episode_num: number
    shot_index: number
    prompt: string
    prompt_cn?: string
    aspect_ratio: string
    duration: number
    generate_audio?: boolean
    image_task_id?: string
    reference_file_id?: string
    first_frame_key?: string
    reference_image_keys?: string[]
    reference_video_key?: string
    audio_key?: string
  }): Promise<{ task_id: string }> {
    const resp = await apiClient.post<{ data: { task_id: string } }>(
      '/api/v1/drama/generate-shot-video',
      params
    )
    return resp.data.data
  },

  async composeFinal(params: {
    drama_project_id: string
    episode_num: number
    title?: string
    aspect_ratio: string
    video_task_ids: string[]
    subtitle?: string
  }): Promise<{ task_id: string }> {
    const resp = await apiClient.post<{ data: { task_id: string } }>(
      '/api/v1/drama/compose-final',
      params
    )
    return resp.data.data
  },

  // 多集合并成剧：各集成片按序聚合为整剧（可选转场）
  async composeSeries(params: {
    drama_project_id: string
    title?: string
    aspect_ratio: string
    episode_task_ids: string[]
    transition: 'none' | 'crossfade' | 'fade'
    transition_duration?: number
  }): Promise<{ task_id: string }> {
    const resp = await apiClient.post<{ data: { task_id: string } }>(
      '/api/v1/drama/compose-series',
      params,
    )
    return resp.data.data
  },

  // 放映剧场：列出本项目已完成的合并成剧作品（最新在前）
  async listSeriesWorks(dramaProjectId: string): Promise<SeriesWork[]> {
    const resp = await apiClient.get<{ data: SeriesWork[] }>(
      '/api/v1/drama/series-works',
      { params: { drama_project_id: dramaProjectId } },
    )
    return resp.data.data || []
  },

  // 放映剧场：重命名作品（标题决定展示名与下载文件名）
  async renameSeriesWork(taskId: string, title: string): Promise<void> {
    await apiClient.patch(`/api/v1/drama/series-works/${taskId}`, { title })
  },

  // 放映剧场：删除作品（软删除）
  async deleteSeriesWork(taskId: string): Promise<void> {
    await apiClient.delete(`/api/v1/drama/series-works/${taskId}`)
  },

  async uploadAsset(
    file: File,
    dramaProjectId: string,
    assetType: 'video' | 'audio' | 'image',
  ): Promise<{ object_key: string; filename: string }> {
    const form = new FormData()
    form.append('file', file)
    form.append('drama_project_id', dramaProjectId)
    form.append('asset_type', assetType)
    const resp = await apiClient.post<{ data: { object_key: string; filename: string } }>(
      '/api/v1/drama/upload-asset',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return resp.data.data
  },

  // 取某分镜自有素材（MinIO object key）的可预览 URL：后端校验归属并返回签名的 ref-asset 地址
  async assetPreviewUrl(objectKey: string): Promise<string> {
    const resp = await apiClient.get<{ data: { url: string } }>(
      '/api/v1/drama/asset-preview',
      { params: { key: objectKey } },
    )
    return resp.data.data.url
  },

  // 实际提交给视频生成 API 的请求体预览（资源 URL 为真实可访问的 proxy 地址，后端签名）
  async previewPayload(params: {
    global_desc?: string
    beats?: { time?: string; action?: string; shotSize?: string }[]
    images?: { key: string; label?: string; frame?: 'first' | 'last'; usage?: string; desc?: string }[]
    reference_video_key?: string
    reference_video_label?: string
    audio_key?: string
    audio_label?: string
    composition?: string
    narration?: string
    bgm_label?: string
    aspect_ratio?: string
    duration?: number
  }): Promise<{ prompt: string; payload: Record<string, unknown> }> {
    const resp = await apiClient.post<{ data: { prompt: string; payload: Record<string, unknown> } }>(
      '/api/v1/drama/preview-payload',
      params,
    )
    return resp.data.data
  },

  // ── 多beat短片合成 (独立模式 → Seedance 2.0 时间段分镜) ──────────────────

  async generateBeatScript(params: {
    description: string
    duration: number
    aspect_ratio: string
  }): Promise<{ global: string; beats: { time: string; action: string; sfx?: string; voice?: string }[] }> {
    const resp = await apiClient.post<{ global: string; beats: { time: string; action: string; sfx?: string; voice?: string }[] }>(
      '/api/v1/drama/beat-script',
      params,
    )
    return resp.data
  },

  async composeVideo(params: {
    drama_project_id?: string | null
    prompt: string
    aspect_ratio: string
    duration: number
    generate_audio?: boolean
    first_frame_key?: string
    last_frame_key?: string
    reference_image_keys?: string[]
    reference_video_key?: string
    audio_key?: string
    // 「合并成片」模式 B：多段已生成分镜视频作参考
    reference_video_keys?: string[]
    reference_shot_task_ids?: string[]
    episode_num?: number
    as_episode_composite?: boolean
  }): Promise<{ task_id: string }> {
    const resp = await apiClient.post<{ data: { task_id: string } }>(
      '/api/v1/drama/compose-video',
      params,
    )
    return resp.data.data
  },

  // 「合并成片」请求体预览（concat / seedance 两模式）
  async composePreviewPayload(params: {
    mode: 'concat' | 'seedance'
    drama_project_id: string
    episode_num: number
    title?: string
    aspect_ratio: string
    video_task_ids: string[]
    merge_prompt?: string
    beats?: { time?: string; action?: string }[]
    duration?: number
  }): Promise<{ prompt: string; payload: Record<string, unknown> }> {
    const resp = await apiClient.post<{ data: { prompt: string; payload: Record<string, unknown> } }>(
      '/api/v1/drama/compose-preview-payload',
      params,
    )
    return resp.data.data
  },

  // ── AI Polish (一键润色) ───────────────────────────────────────────────

  async polishText(
    text: string,
    type: 'character' | 'script' | 'scene' | 'action',
  ): Promise<string> {
    const resp = await apiClient.post<{ data: { polished: string } }>(
      '/api/v1/drama/polish',
      { text, type },
    )
    return resp.data.data.polished
  },
}
