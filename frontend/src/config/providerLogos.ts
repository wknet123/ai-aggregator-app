// 平台集成模型的品牌图标（自绘 SVG 徽标，非官方商标复制品；后续可同名替换为官方文件）。
// 单一来源：provider / modelId → 徽标 + 品牌色 + 是否新上线。
import wanLogo from '../assets/logos/wan.svg'
import happyhorseLogo from '../assets/logos/happyhorse.svg'
import seedanceLogo from '../assets/logos/seedance.svg'
import hailuoLogo from '../assets/logos/hailuo.svg'
import deepseekLogo from '../assets/logos/deepseek.svg'
import genericLogo from '../assets/logos/generic.svg'

export interface ProviderLogoMeta {
  /** 打包后带 hash 的 SVG URL */
  logo: string
  /** 展示名，用作 img alt */
  label: string
  /** 文字/强调用的 tailwind 颜色类（保留原 ModelSelector 语义） */
  color: string
  /** 是否标记 New */
  isNew?: boolean
}

/** provider 名 → 徽标元数据（键小写归一化后匹配） */
const BY_PROVIDER: Record<string, ProviderLogoMeta> = {
  wan: { logo: wanLogo, label: 'Wan', color: 'text-purple-400', isNew: true },
  hailuo: { logo: hailuoLogo, label: 'Hailuo', color: 'text-blue-400', isNew: true },
  happyhorse: { logo: happyhorseLogo, label: 'HappyHorse', color: 'text-pink-400', isNew: true },
  seedance: { logo: seedanceLogo, label: 'Seedance', color: 'text-cyan-400', isNew: true },
  deepseek: { logo: deepseekLogo, label: 'DeepSeek', color: 'text-indigo-400' },
}

/** modelId 前缀 → provider 键（用于只拿到 modelId 的场景） */
const MODEL_ID_HINTS: Array<[RegExp, string]> = [
  [/^wan/i, 'wan'],
  [/hailuo/i, 'hailuo'],
  [/happyhorse/i, 'happyhorse'],
  [/seedance|doubao-seedance/i, 'seedance'],
  [/deepseek/i, 'deepseek'],
]

export const GENERIC_LOGO: ProviderLogoMeta = {
  logo: genericLogo,
  label: 'AI 模型',
  color: 'text-gray-400',
}

/** 归一化键：去空格、转小写 */
function normalizeKey(key: string): string {
  return (key || '').trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 由 provider 名或 modelId 解析徽标元数据。
 * 优先精确匹配 provider，其次按 modelId 前缀推断，最后回退 generic。
 */
export function getProviderLogo(key: string | undefined | null): ProviderLogoMeta {
  if (!key) return GENERIC_LOGO
  const norm = normalizeKey(key)
  if (BY_PROVIDER[norm]) return BY_PROVIDER[norm]
  for (const [re, prov] of MODEL_ID_HINTS) {
    if (re.test(key)) return BY_PROVIDER[prov]
  }
  return GENERIC_LOGO
}

export const PROVIDER_LOGOS = BY_PROVIDER
