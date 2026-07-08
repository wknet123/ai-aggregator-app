/**
 * Project Asset Service
 * Manages per-project 角色 / 场景 / 道具 configuration assets (list, CRUD, images)
 * for OmniWeaver Pro's 「配置」 tab.
 */
import { apiClient } from './api'

export type AssetType = 'character' | 'scene' | 'prop'

export interface ProjectAssetImageRecord {
  id: number
  image_path: string
  is_cover: number
  sort_order: number
}

export interface ProjectAssetRecord {
  id: number
  asset_id: string
  project_id: string
  asset_type: AssetType
  name: string
  description: string | null
  cover_path: string | null
  sort_order: number
  images: ProjectAssetImageRecord[]
  created_at: string
  updated_at: string
}

interface ProjectAssetListResponse {
  items: ProjectAssetRecord[]
  total: number
}

export const projectAssetService = {
  async listAssets(params: { project_id: string; asset_type?: AssetType; q?: string }): Promise<ProjectAssetRecord[]> {
    const p = new URLSearchParams()
    p.append('project_id', params.project_id)
    if (params.asset_type) p.append('asset_type', params.asset_type)
    if (params.q) p.append('q', params.q)
    const resp = await apiClient.get<{ data: ProjectAssetListResponse }>(
      `/api/v1/project-assets?${p.toString()}`,
    )
    return resp.data.data.items
  },

  /** Create an asset. First image in `images` becomes the 主图 (cover). */
  async createAsset(
    payload: { project_id: string; asset_type: AssetType; name: string; description?: string; images: File[] },
    onUploadProgress?: (pct: number) => void,
  ): Promise<ProjectAssetRecord> {
    const fd = new FormData()
    fd.append('project_id', payload.project_id)
    fd.append('asset_type', payload.asset_type)
    fd.append('name', payload.name)
    if (payload.description) fd.append('description', payload.description)
    for (const file of payload.images) fd.append('images', file)

    const resp = await apiClient.post<{ data: ProjectAssetRecord }>(
      '/api/v1/project-assets',
      fd,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onUploadProgress && e.total) {
            onUploadProgress(Math.round((e.loaded * 100) / e.total))
          }
        },
      },
    )
    return resp.data.data
  },

  async getAsset(assetId: string): Promise<ProjectAssetRecord> {
    const resp = await apiClient.get<{ data: ProjectAssetRecord }>(`/api/v1/project-assets/${assetId}`)
    return resp.data.data
  },

  async updateAsset(
    assetId: string,
    payload: { name?: string; description?: string },
  ): Promise<ProjectAssetRecord> {
    const fd = new FormData()
    if (payload.name !== undefined) fd.append('name', payload.name)
    if (payload.description !== undefined) fd.append('description', payload.description)
    const resp = await apiClient.put<{ data: ProjectAssetRecord }>(
      `/api/v1/project-assets/${assetId}`,
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return resp.data.data
  },

  async deleteAsset(assetId: string): Promise<void> {
    await apiClient.delete(`/api/v1/project-assets/${assetId}`)
  },

  /** Append 副图 via uploaded files and/or a completed Flux text-to-image task. */
  async addImages(
    assetId: string,
    payload: { files?: File[]; fluxTaskId?: string },
  ): Promise<ProjectAssetRecord> {
    const fd = new FormData()
    for (const file of payload.files || []) fd.append('images', file)
    if (payload.fluxTaskId) fd.append('flux_task_id', payload.fluxTaskId)
    const resp = await apiClient.post<{ data: ProjectAssetRecord }>(
      `/api/v1/project-assets/${assetId}/images`,
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return resp.data.data
  },

  async deleteImage(assetId: string, imageId: number): Promise<ProjectAssetRecord> {
    const resp = await apiClient.delete<{ data: ProjectAssetRecord }>(
      `/api/v1/project-assets/${assetId}/images/${imageId}`,
    )
    return resp.data.data
  },

  /** Build an image streaming URL for an asset image. */
  imageUrl(assetId: string, imageId: number): string {
    return `/api/v1/project-assets/${assetId}/images/${imageId}/file`
  },
}
