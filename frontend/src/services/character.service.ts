/**
 * Character Identity Service
 * Manages character assets (upload, list, CRUD) for OmniWeaver Pro.
 */
import { apiClient } from './api'
import type { CharacterProfile } from './drama.service'

// ── Types ──────────────────────────────────────────────────────────────────

export interface CharacterImageRecord {
  id: number
  image_path: string
  sort_order: number
}

export interface CharacterRecord {
  id: number
  character_id: string
  name: string
  prompt_description: string | null
  profile_json: CharacterProfile | null
  feature_vector: number[] | null
  fingerprint: string | null
  status: 'draft' | 'processing' | 'active'
  avatar_path: string | null
  images: CharacterImageRecord[]
  created_at: string
  updated_at: string
}

interface CharacterListResponse {
  items: CharacterRecord[]
  total: number
  limit: number
  offset: number
}

// ── Service ────────────────────────────────────────────────────────────────

export const characterService = {
  /**
   * Create a character with 1-3 reference images.
   * Uses FormData for file upload; returns the created character.
   * Accepts an optional `onUploadProgress` callback for progress tracking.
   */
  async createCharacter(
    payload: { name: string; prompt_description?: string; images: File[] },
    onUploadProgress?: (pct: number) => void,
  ): Promise<CharacterRecord> {
    const fd = new FormData()
    fd.append('name', payload.name)
    if (payload.prompt_description) {
      fd.append('prompt_description', payload.prompt_description)
    }
    for (const file of payload.images) {
      fd.append('images', file)
    }

    const resp = await apiClient.post<{ data: CharacterRecord }>(
      '/api/v1/characters',
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

  async listCharacters(params: { q?: string; limit?: number; offset?: number } = {}): Promise<CharacterListResponse> {
    const p = new URLSearchParams()
    if (params.q) p.append('q', params.q)
    if (params.limit) p.append('limit', String(params.limit))
    if (params.offset) p.append('offset', String(params.offset))
    const resp = await apiClient.get<{ data: CharacterListResponse }>(
      `/api/v1/characters?${p.toString()}`,
    )
    return resp.data.data
  },

  async getCharacter(characterId: string): Promise<CharacterRecord> {
    const resp = await apiClient.get<{ data: CharacterRecord }>(
      `/api/v1/characters/${characterId}`,
    )
    return resp.data.data
  },

  async updateCharacter(
    characterId: string,
    payload: { name?: string; prompt_description?: string; profile_json?: string },
  ): Promise<CharacterRecord> {
    const fd = new FormData()
    if (payload.name) fd.append('name', payload.name)
    if (payload.prompt_description !== undefined) {
      fd.append('prompt_description', payload.prompt_description)
    }
    if (payload.profile_json !== undefined) {
      fd.append('profile_json', payload.profile_json)
    }
    const resp = await apiClient.put<{ data: CharacterRecord }>(
      `/api/v1/characters/${characterId}`,
      fd,
    )
    return resp.data.data
  },

  async deleteCharacter(characterId: string): Promise<void> {
    await apiClient.delete(`/api/v1/characters/${characterId}`)
  },

  /** Build an image streaming URL for a character reference image. */
  imageUrl(characterId: string, imageId: number): string {
    return `/api/v1/characters/${characterId}/images/${imageId}/file`
  },
}
