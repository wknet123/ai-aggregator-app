/**
 * Shared types, constants, and helper functions for the OmniWeaver drama pipeline.
 */
import {
  MaterialsData, MaterialItem, ShotItem, CharacterProfile,
  buildCharacterDescription,
} from '../services/drama.service'

// ── Shared Types ──────────────────────────────────────────────────────────────

export interface ShotState extends ShotItem {
  imageTaskId?: string
  imageUrl?: string
  imageStatus?: 'idle' | 'loading' | 'done' | 'error'
  referenceImageUrl?: string
  referenceFileId?: string
  // Per-shot video (剧创式逐分镜 → Seedance 2.0)
  videoTaskId?: string
  videoUrl?: string                       // MinIO key / result url of the shot video
  videoStatus?: 'idle' | 'loading' | 'done' | 'error'
  videoError?: string
  videoDuration?: number                  // seconds chosen for this shot
  generateAudio?: boolean                 // Seedance generate_audio toggle
  // Multimodal reference slots (Seedance 2.0)
  refVideoKey?: string                    // MinIO key of a reference video
  refVideoName?: string                   // runtime-only display label
  refAudioKey?: string                    // MinIO key of a reference / dub audio
  refAudioName?: string                   // runtime-only display label
}

export interface EpisodeVideoState {
  taskId?: string
  videoUrl?: string
  status: 'idle' | 'loading' | 'done' | 'error'
  error?: string
}

export interface HistoryImage {
  displayUrl: string
  prompt: string
}

export interface DramaEditorState {
  outline: import('../services/drama.service').OutlineResponse | null
  concept: string
  script: string                       // imported full script (剧本生短剧)
  sourceMode: 'concept' | 'script'     // which entry produced the outline
  styleLock: string                    // '' | 2d | 3d | realistic (全局风格锁定)
  materials: MaterialsData
  storyboards: Record<number, ShotState[]>
  episodeVideos: Record<number, EpisodeVideoState>
  activeEpisode: number
}

export const DEFAULT_MATERIALS: MaterialsData = {
  characters: [],
  sets: [],
  props: [],
  style: { colorPalette: '', visualStyle: '', additionalNotes: '' },
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const STAGES = [
  { id: 0, label: '故事创作', desc: '生成剧集大纲' },
  { id: 1, label: '分镜规划', desc: '生成分镜脚本' },
  { id: 2, label: '图像生成', desc: '生成分镜图像' },
  { id: 3, label: '分镜视频', desc: '逐镜头生成视频' },
  { id: 4, label: '成片', desc: '拼接镜头成片' },
]

export const GENRES = ['都市', '古风', '悬疑', '玄幻', '爱情', '励志', '惊悚', '科幻']
export const ART_STYLES = ['写实', '动漫', '国风', '赛博朋克', '童话']
export const ASPECT_RATIOS = ['9:16', '16:9', '1:1']
export const EPISODE_COUNTS = [2, 3, 5, 8]
export const SHOT_COUNTS = [4, 6, 8, 10, 12, 15, 20]
export const IMAGE_MODELS = [
  { id: 'wan2.7-image', label: 'Wan 2.7 图像', credits: 40 },
  { id: 'wan2.7-image-pro', label: 'Wan 2.7 Pro', credits: 80 },
]

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:       { label: '草稿',   cls: 'bg-gray-500/20 text-gray-400 border-gray-500/20' },
  in_progress: { label: '进行中', cls: 'bg-blue-500/20 text-blue-400 border-blue-500/20' },
  completed:   { label: '已完成', cls: 'bg-green-500/20 text-green-400 border-green-500/20' },
  archived:    { label: '已归档', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/20' },
}

export const shotTypeLabel: Record<string, string> = {
  'close-up': '特写',
  medium: '中景',
  wide: '全景',
  aerial: '俯拍',
  POV: '主观视角',
}

// ── Helper: useDebounce ───────────────────────────────────────────────────────

import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ── Materials Context Builder ─────────────────────────────────────────────────

/** Build a character card block from structured CharacterProfile */
/** 全局风格锁定 options — coarse rendering medium applied across the whole drama */
export const STYLE_LOCKS = [
  { id: 'realistic', label: '仿真人', directive: 'photorealistic live-action film look, real human actors, cinematic photography, natural lighting' },
  { id: '3d', label: '3D', directive: '3D rendered CGI animation, Pixar / Unreal-engine look, subsurface scattering, volumetric lighting' },
  { id: '2d', label: '2D', directive: '2D anime / animation illustration, flat cel shading, clean line art, hand-drawn look' },
] as const

export type StyleLockId = (typeof STYLE_LOCKS)[number]['id']

/** Return {label, directive} for a style-lock id, or undefined when no lock is set */
export function styleLockInfo(id?: string): { label: string; directive: string } | undefined {
  return STYLE_LOCKS.find(s => s.id === id)
}

/** Append a character's 变装/造型 variants to a context card block */
function buildVariantLines(c: MaterialItem): string[] {
  const vs = (c.variants ?? []).filter(v => v.name && v.description)
  if (!vs.length) return []
  return [`- 变装/造型: ${vs.map(v => `${v.name}(${v.description})`).join('；')}`]
}

function buildCharacterCardBlock(c: MaterialItem, locked: boolean): string {
  const profile = c.characterProfile
  if (!profile) {
    // Fallback: freeform description (backward compat)
    const tag = locked ? '（锁定）' : ''
    const base = c.description ? `- ${c.name}${tag}: ${c.description}` : `- ${c.name}${tag}`
    return [base, ...buildVariantLines(c)].join('\n')
  }

  const lines: string[] = []
  const tag = locked ? `（锁定）` : ''
  lines.push(`【角色统一卡 - ${c.name}${tag}】`)
  if (profile.age) lines.push(`- 年龄: ${profile.age}岁`)
  if (profile.personality?.length) lines.push(`- 性格: ${profile.personality.join('、')}`)
  lines.push(`- 面部特征: ${profile.facialFeatures}`)
  if (profile.symbolicFeatures) lines.push(`- 标志性特征: ${profile.symbolicFeatures}`)
  lines.push(`- 服装: ${profile.clothing}`)
  if (profile.accessories) lines.push(`- 配饰: ${profile.accessories}`)
  lines.push(`- 身材体态: ${profile.figure}`)
  lines.push(`- 默认情绪: ${profile.currentEmotion}`)
  if (profile.microExpression) lines.push(`- 微表情: ${profile.microExpression}`)
  lines.push(...buildVariantLines(c))
  if (locked) lines.push(`★ 全程统一，禁止代词混用，禁止外貌描述偏差`)
  return lines.join('\n')
}

export function buildMaterialsContext(materials: MaterialsData, styleLock?: string): string | undefined {
  const parts: string[] = []

  const lock = styleLockInfo(styleLock)
  if (lock) {
    parts.push('【全局风格锁定 - 全剧所有镜头必须严格统一为此渲染风格，禁止跨风格混用】')
    parts.push(`- 风格: ${lock.label}`)
    parts.push(`- 渲染要求(英文): ${lock.directive}`)
    parts.push('')
  }

  const lockedChars = materials.characters.filter(c => c.locked && c.name)
  const unlockedChars = materials.characters.filter(c => !c.locked && c.name)

  if (lockedChars.length > 0) {
    parts.push('【锁定角色 - 必须出现在所有集中，外貌描述不可变更】')
    for (const c of lockedChars) {
      parts.push(buildCharacterCardBlock(c, true))
    }
  }

  if (unlockedChars.length > 0) {
    if (parts.length > 0) parts.push('')
    parts.push('【角色设定】')
    for (const c of unlockedChars) {
      parts.push(buildCharacterCardBlock(c, false))
    }
  }

  if (materials.sets.length > 0) {
    parts.push('')
    parts.push('【布景设定】')
    for (const s of materials.sets) {
      if (s.name && s.description) {
        parts.push(`- ${s.name}: ${s.description}`)
      }
    }
  }

  if (materials.props.length > 0) {
    parts.push('')
    parts.push('【辅助附件】')
    for (const p of materials.props) {
      if (p.name && p.description) {
        parts.push(`- ${p.name}: ${p.description}`)
      }
    }
  }

  const { colorPalette, visualStyle, additionalNotes } = materials.style
  if (colorPalette || visualStyle || additionalNotes) {
    parts.push('')
    parts.push('【视觉风格】')
    if (colorPalette) parts.push(`- 色调: ${colorPalette}`)
    if (visualStyle) parts.push(`- 风格: ${visualStyle}`)
    if (additionalNotes) parts.push(`- 备注: ${additionalNotes}`)
  }

  return parts.length > 0 ? parts.join('\n') : undefined
}

// ── Enriched Prompt Builder ───────────────────────────────────────────────────

/** Build an enriched English prompt by prepending material descriptions from structured profiles */
export function buildEnrichedPrompt(shot: ShotState, materials: MaterialsData, styleLock?: string): string {
  const parts: string[] = []

  const lock = styleLockInfo(styleLock)
  if (lock) parts.push(`[Global style lock: ${lock.directive}]`)

  // Add matched character descriptions — use structured profile if available
  for (const charName of shot.characters) {
    const mat = materials.characters.find(
      c => c.name && (charName.includes(c.name) || c.name.includes(charName))
    )
    if (!mat) continue

    const profile = mat.characterProfile
    if (profile) {
      // Build precise English prompt from structured fields
      const agePart = profile.age ? `${profile.age} year old` : ''
      const facePart = profile.facialFeatures || ''
      const figurePart = profile.figure || ''
      const clothingPart = profile.clothing ? `wearing ${profile.clothing}` : ''
      const accessoryPart = profile.accessories ? `with ${profile.accessories}` : ''
      const symbolicPart = profile.symbolicFeatures || ''
      const desc = [agePart, figurePart, facePart, symbolicPart, clothingPart, accessoryPart]
        .filter(Boolean).join(', ')
      parts.push(`[Character: ${mat.name}] same person as ${mat.name}, ${desc}`)
    } else if (mat.description) {
      parts.push(`[Character "${mat.name}": ${mat.description}]`)
    }
  }

  // Add matched set description
  const setMat = materials.sets.find(
    s => s.name && s.description && (shot.scene.includes(s.name) || s.name.includes(shot.scene))
  )
  if (setMat) parts.push(`[Set "${setMat.name}": ${setMat.description}]`)

  // Add matched prop descriptions
  const shotProps = shot.props
  if (shotProps?.length) {
    for (const propName of shotProps) {
      const propMat = materials.props.find(
        p => p.name && p.description && (propName.includes(p.name) || p.name.includes(propName))
      )
      if (propMat) parts.push(`[Prop "${propMat.name}": ${propMat.description}]`)
    }
  }

  // Add style guide
  const { colorPalette, visualStyle, additionalNotes } = materials.style
  const styleParts = [colorPalette, visualStyle, additionalNotes].filter(Boolean)
  if (styleParts.length) parts.push(`[Style: ${styleParts.join(', ')}]`)

  if (parts.length === 0) return shot.prompt
  return parts.join(' ') + ' ' + shot.prompt
}

// ── Reference Image Selection ─────────────────────────────────────────────────

/** Find the best material reference image for a shot, supporting multi-reference images with angle matching */
export function findMaterialRefForShot(
  shot: ShotState,
  materials: MaterialsData,
  storyboards: Record<number, ShotState[]>,
  episodeNum: number | undefined,
): string | undefined {
  if (shot.referenceFileId) return undefined // already has manual reference

  // Priority 0 (Chain Reference): find previously-generated shot with same character
  if (shot.characters.length > 0 && episodeNum !== undefined) {
    const epShots = storyboards[episodeNum] ?? []
    for (let i = epShots.length - 1; i >= 0; i--) {
      const prev = epShots[i]
      if (prev.index >= shot.index) continue
      if (prev.imageStatus !== 'done' || (!prev.referenceFileId && !prev.imageTaskId)) continue
      const sharedChar = prev.characters.some(pc =>
        shot.characters.some(sc => sc.includes(pc) || pc.includes(sc))
      )
      if (sharedChar && prev.referenceFileId) return prev.referenceFileId
    }
  }

  // Priority 1: character reference from materials (with angle matching for multi-ref)
  for (const charName of shot.characters) {
    const mat = materials.characters.find(
      c => c.name && (charName.includes(c.name) || c.name.includes(charName))
    )
    if (!mat) continue

    // Multi-reference images: pick best angle based on shot type
    const profile = mat.characterProfile
    if (profile?.referenceImages?.length) {
      const anglePreference: Record<string, string[]> = {
        'close-up': ['front', 'half-body', 'side'],
        medium: ['half-body', 'front', 'full-body'],
        wide: ['full-body', 'half-body', 'front'],
        aerial: ['full-body', 'half-body', 'front'],
        POV: ['front', 'half-body', 'side'],
      }
      const preferred = anglePreference[shot.shot_type] ?? ['front', 'half-body', 'full-body']
      for (const angle of preferred) {
        const img = profile.referenceImages.find(r => r.angle === angle && r.fileId)
        if (img) return img.fileId
      }
      // Fallback to any available reference image
      const anyImg = profile.referenceImages.find(r => r.fileId)
      if (anyImg) return anyImg.fileId
    }

    // Legacy single reference
    if (mat.referenceFileId) return mat.referenceFileId
  }

  // Priority 2: set reference
  const setMat = materials.sets.find(
    s => s.referenceFileId && s.name && (shot.scene.includes(s.name) || s.name.includes(shot.scene))
  )
  if (setMat?.referenceFileId) return setMat.referenceFileId

  // Priority 3: prop reference
  if (shot.props?.length) {
    for (const propName of shot.props) {
      const propMat = materials.props.find(
        p => p.referenceFileId && p.name && (propName.includes(p.name) || p.name.includes(propName))
      )
      if (propMat?.referenceFileId) return propMat.referenceFileId
    }
  }

  return undefined
}
