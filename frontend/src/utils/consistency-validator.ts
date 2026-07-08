/**
 * 一致性校验模块 – Character Consistency Validator
 *
 * Validates shots against character templates and art style rules.
 * Used as a gate between stages (Stage 2→3, and before batch image generation).
 */
import { MaterialsData, MaterialItem, CharacterProfile } from '../services/drama.service'
import { ShotState, buildEnrichedPrompt } from './drama-helpers'
import type { OutlineResponse } from '../services/drama.service'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ValidationLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: ValidationLevel
  rule: string
  message: string
  shotIndex?: number    // which shot has the issue (if applicable)
  characterName?: string
}

export interface ValidationResult {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  isValid: boolean       // true if no errors (warnings are ok)
}

// ── Style Domain Mapping ──────────────────────────────────────────────────────

type StyleDomain = 'realistic' | 'anime' | '3d' | 'chinese-painting' | 'cyberpunk' | 'fairy-tale'

const ART_STYLE_DOMAIN: Record<string, StyleDomain> = {
  '写实': 'realistic',
  '动漫': 'anime',
  '3D': '3d',
  '国风': 'chinese-painting',
  '赛博朋克': 'cyberpunk',
  '童话': 'fairy-tale',
}

// Compatible domains (can coexist)
const DOMAIN_COMPAT: Record<StyleDomain, StyleDomain[]> = {
  'realistic': ['realistic', 'chinese-painting', 'cyberpunk'],
  'anime': ['anime', 'fairy-tale'],
  '3d': ['3d'],
  'chinese-painting': ['chinese-painting', 'realistic'],
  'cyberpunk': ['cyberpunk', 'realistic'],
  'fairy-tale': ['fairy-tale', 'anime'],
}

// Keywords that indicate a style domain in English prompts
const STYLE_KEYWORDS: Record<StyleDomain, RegExp[]> = {
  'realistic': [/photorealistic/i, /photo[\s-]?real/i, /realistic/i, /live[\s-]?action/i],
  'anime': [/anime/i, /manga/i, /cel[\s-]?shad/i, /cartoon/i, /2d[\s-]?animation/i],
  '3d': [/3d[\s-]?render/i, /cgi/i, /blender/i, /unreal[\s-]?engine/i, /pixar/i],
  'chinese-painting': [/chinese[\s-]?paint/i, /ink[\s-]?wash/i, /guohua/i, /traditional[\s-]?chinese/i],
  'cyberpunk': [/cyberpunk/i, /neon/i, /dystopian/i, /sci[\s-]?fi[\s-]?city/i],
  'fairy-tale': [/fairy[\s-]?tale/i, /storybook/i, /whimsical/i, /fantasy[\s-]?illustration/i],
}

// ── Pronoun Blocklist ─────────────────────────────────────────────────────────

const PRONOUN_PATTERNS = [
  /\b(she|he|her|him|they|them)\b/gi,
  /(a\s+)(girl|boy|woman|man|lady|gentleman|person|figure)/gi,
  /(the\s+)(girl|boy|woman|man|lady|gentleman|person|figure)/gi,
]

// ── Validator Functions ───────────────────────────────────────────────────────

/**
 * Validate character name consistency across shots.
 * Character names in shots must match exactly with outline/materials.
 */
function validateCharacterNames(
  shots: ShotState[],
  materials: MaterialsData,
  outline: OutlineResponse | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Build set of valid character names
  const validNames = new Set<string>()
  for (const c of materials.characters) {
    if (c.name) validNames.add(c.name)
  }
  if (outline) {
    for (const ep of outline.episodes) {
      for (const c of ep.characters) {
        if (c.name) validNames.add(c.name)
      }
    }
  }

  for (const shot of shots) {
    for (const charName of shot.characters) {
      // Check if character name exists in valid set
      const found = Array.from(validNames).some(
        name => name === charName || name.includes(charName) || charName.includes(name)
      )
      if (!found && validNames.size > 0) {
        issues.push({
          level: 'warning',
          rule: '角色名匹配',
          message: `镜头 #${shot.index} 中的角色「${charName}」未在素材库或大纲中定义`,
          shotIndex: shot.index,
          characterName: charName,
        })
      }
    }
  }

  return issues
}

/**
 * Validate that locked characters appear in every episode.
 */
function validateLockedCharacterCoverage(
  storyboards: Record<number, ShotState[]>,
  materials: MaterialsData,
  outline: OutlineResponse | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const lockedChars = materials.characters.filter(c => c.locked && c.name)

  if (!outline || lockedChars.length === 0) return issues

  for (const ep of outline.episodes) {
    const epShots = storyboards[ep.episode] ?? []
    for (const locked of lockedChars) {
      const appears = epShots.some(shot =>
        shot.characters.some(c => c === locked.name || c.includes(locked.name!) || locked.name!.includes(c))
      )
      if (!appears) {
        issues.push({
          level: 'warning',
          rule: '锁定角色覆盖',
          message: `锁定角色「${locked.name}」未在第 ${ep.episode} 集的分镜中出现`,
          characterName: locked.name,
        })
      }
    }
  }

  return issues
}

/**
 * Validate character profile completeness for locked characters.
 */
function validateProfileCompleteness(materials: MaterialsData): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const c of materials.characters.filter(ch => ch.locked && ch.name)) {
    const profile = c.characterProfile
    if (!profile) {
      issues.push({
        level: 'warning',
        rule: '角色模板完整性',
        message: `锁定角色「${c.name}」尚未创建结构化模板（角色统一卡）`,
        characterName: c.name,
      })
      continue
    }

    const missing: string[] = []
    if (!profile.facialFeatures) missing.push('面部特征')
    if (!profile.clothing) missing.push('服装')
    if (!profile.figure) missing.push('身材体态')
    if (!profile.age) missing.push('年龄')
    if (!profile.personality?.length) missing.push('性格')

    if (missing.length > 0) {
      issues.push({
        level: 'warning',
        rule: '角色模板完整性',
        message: `角色「${c.name}」的统一卡缺少：${missing.join('、')}`,
        characterName: c.name,
      })
    }
  }

  return issues
}

/**
 * Validate that the prompt actually sent to the image model contains each
 * character's visual features.
 *
 * The string fed to the model is NOT the raw `shot.prompt` — it's
 * `buildEnrichedPrompt(...)`, which injects `[Character: Name] same person as Name, <profile>`
 * for every matched character. So we must validate that enriched prompt; checking
 * the raw prompt produced false errors for every shot whose name reference is
 * supplied by enrichment rather than typed into the prompt body.
 */
function validateVisualFeaturePresence(
  shots: ShotState[],
  materials: MaterialsData,
  styleLock?: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const shot of shots) {
    const enriched = buildEnrichedPrompt(shot, materials, styleLock).toLowerCase()
    for (const charName of shot.characters) {
      const mat = materials.characters.find(
        c => c.name && c.characterProfile && (charName.includes(c.name) || c.name.includes(charName))
      )
      if (!mat?.characterProfile) continue

      // Check if the enriched prompt references the character by name.
      if (!enriched.includes(mat.name.toLowerCase())) {
        issues.push({
          level: 'error',
          rule: '视觉特征完整性',
          message: `镜头 #${shot.index} 的生成 prompt 未包含角色「${mat.name}」的名称引用`,
          shotIndex: shot.index,
          characterName: mat.name,
        })
      }
    }
  }

  return issues
}

/**
 * Validate that prompts don't use pronouns instead of character names.
 */
function validateNoPronounSubstitution(shots: ShotState[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const shot of shots) {
    // Only check shots that have characters assigned
    if (shot.characters.length === 0) continue

    for (const pattern of PRONOUN_PATTERNS) {
      const matches = shot.prompt.match(pattern)
      if (matches && matches.length > 0) {
        issues.push({
          level: 'warning',
          rule: '禁止代词混用',
          message: `镜头 #${shot.index} 的 prompt 使用了代词「${matches[0]}」，建议使用角色名`,
          shotIndex: shot.index,
        })
        break // one warning per shot is enough
      }
    }
  }

  return issues
}

/**
 * Validate art style consistency — no cross-style mixing.
 */
function validateStyleConsistency(
  shots: ShotState[],
  artStyle: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const projectDomain = ART_STYLE_DOMAIN[artStyle]
  if (!projectDomain) return issues

  const compatDomains = DOMAIN_COMPAT[projectDomain] ?? [projectDomain]

  for (const shot of shots) {
    for (const [domain, patterns] of Object.entries(STYLE_KEYWORDS)) {
      if (compatDomains.includes(domain as StyleDomain)) continue
      for (const pattern of patterns) {
        if (pattern.test(shot.prompt)) {
          issues.push({
            level: 'error',
            rule: '风格一致性',
            message: `镜头 #${shot.index} 的 prompt 包含与「${artStyle}」风格冲突的关键词（${domain}风格）`,
            shotIndex: shot.index,
          })
          break
        }
      }
    }
  }

  return issues
}

// ── Main Validator ─────────────────────────────────────────────────────────────

/**
 * Run all consistency validations for a given set of shots.
 */
export function validateConsistency(
  shots: ShotState[],
  materials: MaterialsData,
  outline: OutlineResponse | null,
  storyboards: Record<number, ShotState[]>,
  artStyle: string,
  styleLock?: string,
): ValidationResult {
  const allIssues: ValidationIssue[] = [
    ...validateCharacterNames(shots, materials, outline),
    ...validateProfileCompleteness(materials),
    ...validateLockedCharacterCoverage(storyboards, materials, outline),
    ...validateVisualFeaturePresence(shots, materials, styleLock),
    ...validateNoPronounSubstitution(shots),
    ...validateStyleConsistency(shots, artStyle),
  ]

  const errors = allIssues.filter(i => i.level === 'error')
  const warnings = allIssues.filter(i => i.level === 'warning')

  return {
    errors,
    warnings,
    isValid: errors.length === 0,
  }
}

// ── Pronoun Auto-Repair ─────────────────────────────────────────────────────────

// Pronoun → replaced inline with the character name. Possessive forms get "'s".
const PRONOUN_SUBJECT_OBJECT = /\b(she|he|her|him|they|them)\b/gi
const PRONOUN_POSSESSIVE = /\b(his|hers|their|theirs)\b/gi
const GENERIC_REFERENCE = /\b(a|the)\s+(girl|boy|woman|man|lady|gentleman|person|figure)\b/gi

/**
 * Replace pronouns / generic references in a single prompt with a character name.
 * Only safe to call when the shot unambiguously has ONE character.
 */
function repairPromptPronouns(prompt: string, charName: string): string {
  if (!prompt || !charName) return prompt
  return prompt
    .replace(PRONOUN_POSSESSIVE, `${charName}'s`)
    .replace(PRONOUN_SUBJECT_OBJECT, charName)
    .replace(GENERIC_REFERENCE, charName)
    // collapse accidental duplicates like "Alice Alice" produced by replacement
    .replace(new RegExp(`\\b(${escapeRegExp(charName)})(\\s+\\1\\b)+`, 'g'), '$1')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Auto-repair pronoun misuse across a set of shots.
 *
 * For every shot that has exactly one assigned character, any pronoun or generic
 * reference in its English prompt is rewritten to that character's name. Shots
 * with zero or multiple characters are left untouched (ambiguous — surfaced as a
 * warning by `validateNoPronounSubstitution` for manual review).
 *
 * Returns a NEW array; only changed shots get a new object reference.
 */
export function repairShotPronouns<T extends ShotState>(shots: T[]): T[] {
  return shots.map(shot => {
    if (shot.characters.length !== 1) return shot
    const charName = shot.characters[0]?.trim()
    if (!charName) return shot
    const fixed = repairPromptPronouns(shot.prompt, charName)
    return fixed === shot.prompt ? shot : { ...shot, prompt: fixed }
  })
}
