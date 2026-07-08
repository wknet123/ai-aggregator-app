import type { ModelConfig, ModelCategory } from '../types/model.types'

// 平台所有 AI 模型经聚合网关提供：
//   文生图/图生图 → wan2.7-image / wan2.7-image-pro
//   视频生成      → 海螺 Hailuo 2.3 / HappyHorse 1.0
//   (短剧视频由 OmniWeaver 内部使用 Seedance，不在此通用选择器中)
export const MODELS_CONFIG: ModelConfig[] = [
  // ── 图像：Wan 2.7（文生图 + 图生图）────────────────────────────────
  {
    id: 'wan2.7-image',
    name: 'Wan 2.7 图像',
    provider: 'Wan',
    category: 'image',
    basePrice: 40,
    description: '通义万相 2.7，文生图与参考图生图，速度快、性价比高',
    enabled: true,
    options: [
      {
        key: 'aspect_ratio',
        label: '宽高比',
        type: 'select',
        default: '1:1',
        options: [
          { value: '1:1', label: '1:1 (正方)', priceFactor: 1 },
          { value: '16:9', label: '16:9 (宽屏)', priceFactor: 1 },
          { value: '9:16', label: '9:16 (竖屏)', priceFactor: 1 },
          { value: '4:3', label: '4:3 (标准)', priceFactor: 1 },
          { value: '3:4', label: '3:4 (竖版)', priceFactor: 1 },
          { value: '3:2', label: '3:2 (照片)', priceFactor: 1 },
          { value: '2:3', label: '2:3 (竖版照片)', priceFactor: 1 },
        ],
      },
    ],
  },
  {
    id: 'wan2.7-image-pro',
    name: 'Wan 2.7 Pro',
    provider: 'Wan',
    category: 'image',
    basePrice: 80,
    description: '通义万相 2.7 专业版，更高画质与细节表现',
    enabled: true,
    options: [
      {
        key: 'aspect_ratio',
        label: '宽高比',
        type: 'select',
        default: '1:1',
        options: [
          { value: '1:1', label: '1:1 (正方)', priceFactor: 1 },
          { value: '16:9', label: '16:9 (宽屏)', priceFactor: 1 },
          { value: '9:16', label: '9:16 (竖屏)', priceFactor: 1 },
          { value: '4:3', label: '4:3 (标准)', priceFactor: 1 },
          { value: '3:4', label: '3:4 (竖版)', priceFactor: 1 },
          { value: '3:2', label: '3:2 (照片)', priceFactor: 1 },
          { value: '2:3', label: '2:3 (竖版照片)', priceFactor: 1 },
        ],
      },
    ],
  },

  // ── 视频：海螺 Hailuo 2.3（文生视频 + 图生视频）──────────────────────
  {
    id: 'hailuo',
    name: '海螺 Hailuo 2.3 (即将上线)',
    provider: 'Hailuo',
    category: 'video',
    basePrice: 150,
    description: 'MiniMax 海螺 2.3，文生视频/图生视频，支持运镜控制（网关分组待开通）',
    enabled: false,
    options: [
      {
        key: 'resolution',
        label: '分辨率',
        type: 'select',
        default: '768P',
        options: [
          { value: '768P', label: '768P (高清)', priceFactor: 1 },
          { value: '1080P', label: '1080P (全高清·仅6秒)', priceFactor: 1.5 },
        ],
      },
      {
        key: 'duration',
        label: '视频时长',
        type: 'select',
        default: 6,
        options: [
          { value: 6, label: '6秒', priceFactor: 1 },
          { value: 10, label: '10秒 (仅768P)', priceFactor: 1.6 },
        ],
        unit: '秒',
      },
      {
        key: 'aspect_ratio',
        label: '宽高比',
        type: 'select',
        default: '16:9',
        options: [
          { value: '16:9', label: '16:9 (宽屏)', priceFactor: 1 },
          { value: '9:16', label: '9:16 (竖屏)', priceFactor: 1 },
        ],
      },
    ],
  },

  // ── 视频：HappyHorse 1.0（文生视频 + 图生视频）─────────────────────
  {
    id: 'happyhorse',
    name: 'HappyHorse 1.0',
    provider: 'HappyHorse',
    category: 'video',
    basePrice: 120,
    description: 'HappyHorse 1.0，文生/图生视频，720p / 1080p 多档位',
    enabled: true,
    options: [
      {
        key: 'resolution',
        label: '分辨率',
        type: 'select',
        default: '720p',
        options: [
          { value: '720p', label: '720p (高清)', priceFactor: 1 },
          { value: '1080p', label: '1080p (全高清)', priceFactor: 1.5 },
        ],
      },
      {
        key: 'duration',
        label: '视频时长',
        type: 'select',
        default: 4,
        options: [
          { value: 4, label: '4秒', priceFactor: 1 },
          { value: 6, label: '6秒', priceFactor: 1.3 },
          { value: 8, label: '8秒', priceFactor: 1.6 },
        ],
        unit: '秒',
      },
      {
        key: 'aspect_ratio',
        label: '宽高比',
        type: 'select',
        default: '16:9',
        options: [
          { value: '16:9', label: '16:9 (宽屏)', priceFactor: 1 },
          { value: '9:16', label: '9:16 (竖屏)', priceFactor: 1 },
          { value: '1:1', label: '1:1 (正方)', priceFactor: 1 },
        ],
      },
    ],
  },
]

export const CATEGORIES: Array<{ id: ModelCategory; label: string; icon: string }> = [
  { id: 'image', label: '图像生成', icon: '🖼️' },
  { id: 'video', label: '视频生成', icon: '🎬' },
]

export function getModelsByCategory(category: ModelCategory): ModelConfig[] {
  return MODELS_CONFIG.filter((model) => model.category === category)
}

export function getModelById(modelId: string): ModelConfig | undefined {
  return MODELS_CONFIG.find((model) => model.id === modelId)
}

export function calculateCost(
  modelId: string,
  options: Record<string, any>
): number {
  const model = getModelById(modelId)
  if (!model) return 0

  let cost = model.basePrice

  model.options.forEach((option) => {
    const value = options[option.key]
    if (value === undefined) return

    if (option.type === 'select' && option.options) {
      const selectedOption = option.options.find((opt) => opt.value === value)
      if (selectedOption?.priceFactor) {
        cost *= selectedOption.priceFactor
      }
    } else if (option.type === 'slider' && option.priceFactor) {
      if (option.key === 'n' || option.key === 'steps') {
        cost += value * option.priceFactor
      } else {
        cost *= 1 + (value - option.default!) * option.priceFactor
      }
    }
  })

  return Math.round(cost) // 返回整数积分
}
