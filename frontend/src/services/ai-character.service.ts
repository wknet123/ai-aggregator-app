/**
 * AI Character Library Service
 * 全局只读 AI 角色资源库（AI角色）浏览接口。
 * 用户浏览选择后，通过 applyToProject 实例化为项目内可编辑的角色要素。
 */
import { apiClient } from './api'
import type { ProjectAssetRecord } from './project-asset.service'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AICharacterCategoryNode {
  id: number
  name: string
  path: string
  level: number
  parent_id: number | null
  count: number
  children: AICharacterCategoryNode[]
}

export interface AICharacterImageRef {
  id: number
  slot: number
  sort_order: number
}

export interface AICharacterCard {
  character_key: string
  name: string
  path: string
  cover_image_id: number | null
  attributes: Record<string, string>
}

export interface AICharacterDetail {
  character_key: string
  name: string
  path: string
  attributes: Record<string, string>
  attribute_keys: string[]
  feature_desc: string | null
  costume_desc: string | null
  images: AICharacterImageRef[]
}

interface ListResponse {
  items: AICharacterCard[]
  total: number
  limit: number
  offset: number
}

interface FiltersResponse {
  keys: string[]
  values: Record<string, string[]>
}

// ── Service ────────────────────────────────────────────────────────────────

export const aiCharacterService = {
  async listCategories(): Promise<{ tree: AICharacterCategoryNode[]; total: number }> {
    const resp = await apiClient.get<{ data: { tree: AICharacterCategoryNode[]; total: number } }>(
      '/api/v1/ai-characters/categories',
    )
    return resp.data.data
  },

  async listFilters(categoryPath?: string): Promise<FiltersResponse> {
    const p = new URLSearchParams()
    if (categoryPath) p.append('category_path', categoryPath)
    const resp = await apiClient.get<{ data: FiltersResponse }>(
      `/api/v1/ai-characters/filters?${p.toString()}`,
    )
    return resp.data.data
  },

  /**
   * 角色列表。属性维度筛选以 `filters` 传入（键=属性名，值=选中值数组），
   * 每个维度多值以逗号拼接、维度间为交集（后端语义）。
   */
  async listCharacters(params: {
    categoryPath?: string
    q?: string
    filters?: Record<string, string[]>
    limit?: number
    offset?: number
  } = {}): Promise<ListResponse> {
    const p = new URLSearchParams()
    if (params.categoryPath) p.append('category_path', params.categoryPath)
    if (params.q) p.append('q', params.q)
    if (params.limit) p.append('limit', String(params.limit))
    if (params.offset) p.append('offset', String(params.offset))
    for (const [key, vals] of Object.entries(params.filters || {})) {
      if (vals && vals.length) p.append(key, vals.join(','))
    }
    const resp = await apiClient.get<{ data: ListResponse }>(
      `/api/v1/ai-characters?${p.toString()}`,
    )
    return resp.data.data
  },

  async getCharacter(characterKey: string): Promise<AICharacterDetail> {
    const resp = await apiClient.get<{ data: AICharacterDetail }>(
      `/api/v1/ai-characters/${characterKey}`,
    )
    return resp.data.data
  },

  /** 图片流式 URL（character_key 作能力令牌，可直接用于 <img src>）。 */
  imageUrl(characterKey: string, imageId: number): string {
    return `/api/v1/ai-characters/${characterKey}/images/${imageId}/file`
  },

  /**
   * 「应用到画布」：把一个 AI 角色实例化为当前项目的可编辑角色要素。
   * @param slots 可选，选取的图片 slot 子集（如 [1,3]）；默认全部。
   */
  async applyToProject(payload: {
    projectId: string
    characterKey: string
    name?: string
    slots?: number[]
  }): Promise<ProjectAssetRecord> {
    const fd = new FormData()
    fd.append('project_id', payload.projectId)
    fd.append('ai_character_key', payload.characterKey)
    if (payload.name) fd.append('name', payload.name)
    if (payload.slots && payload.slots.length) fd.append('slots', payload.slots.join(','))
    const resp = await apiClient.post<{ data: ProjectAssetRecord }>(
      '/api/v1/project-assets/from-ai-character',
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return resp.data.data
  },
}
