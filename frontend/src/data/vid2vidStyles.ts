/**
 * Video-to-Video Style Transfer — Style Presets & Model Definitions.
 * 风格预览图走 Pollo.ai CDN;样例视频/水墨预览图托管于 MinIO(/api/v1/static,已验证)。
 */

export interface Vid2VidStyle {
  id: string
  name: string
  description: string
  prompt: string
  gradient: string
  version: 'V5' | 'V4'
  previewImage?: string
}

export interface Vid2VidModel {
  id: string
  name: string
  provider: string
  quality: number  // 1–5
  speed: 'fast' | 'medium' | 'slow'
  credits: number
  description: string
}

// ─── Pollo.ai CDN helper ──────────────────────────────────────────────────────
const POLLO = (name: string) =>
  `https://videocdn.pollo.ai/styles/video2video/${encodeURIComponent(name)}`

// ─── Styles ──────────────────────────────────────────────────────────────────

export const vid2vidStyles: Vid2VidStyle[] = [
  {
    id: 'clay-animation',
    name: '黏土动画',
    description: '泥塑质感 · 逐帧动画',
    prompt: 'clay animation style, plasticine texture, 3D clay character, stop-motion look, vibrant colors',
    gradient: 'linear-gradient(135deg, #f97316 0%, #fb923c 60%, #fdba74 100%)',
    version: 'V5',
    previewImage: POLLO('Clay Animation_v5.png'),
  },
  {
    id: 'anime-style',
    name: '动漫风格',
    description: '赛璐珞渲染 · 日系动画',
    prompt: 'anime style, Japanese animation, cel shading, vibrant colors, clean outlines',
    gradient: 'linear-gradient(135deg, #ec4899 0%, #a855f7 60%, #6366f1 100%)',
    version: 'V5',
    previewImage: POLLO('Anime Style_v5.png'),
  },
  {
    id: 'pixar-style',
    name: '皮克斯风格',
    description: '3D渲染 · 温暖电影光影',
    prompt: 'Pixar 3D animation style, highly detailed, warm lighting, expressive characters, cinematic',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 60%, #22d3ee 100%)',
    version: 'V5',
    previewImage: POLLO('Pixar Style_v5.png'),
  },
  {
    id: 'ghibli-style',
    name: '吉卜力风格',
    description: '手绘水彩 · 宫崎骏美学',
    prompt: 'Studio Ghibli style, Hayao Miyazaki aesthetic, hand-drawn watercolor animation, pastoral atmosphere',
    gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 60%, #6ee7b7 100%)',
    version: 'V5',
    previewImage: POLLO('Ghibli Style_v5.png'),
  },
  {
    id: 'pixel-style',
    name: '像素风格',
    description: '16位像素 · 复古游戏',
    prompt: 'pixel art style, 16-bit retro game graphics, dithering, vibrant pixel colors',
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 60%, #c4b5fd 100%)',
    version: 'V4',
    previewImage: POLLO('Pixel Style_v5.png'),
  },
  {
    id: 'gpt-anime-style',
    name: 'GPT动漫风',
    description: 'AI插画 · 半写实风格',
    prompt: 'GPT anime style, modern AI anime aesthetic, clean illustration, semi-realistic',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 60%, #fcd34d 100%)',
    version: 'V4',
    previewImage: POLLO('GPT Anime Style.jpg'),
  },
  {
    id: 'anime-style-3',
    name: '动漫风格 3',
    description: '少女漫画 · 柔和粉彩色调',
    prompt: 'soft anime style 3, pastel tones, shojo manga aesthetic, delicate line art',
    gradient: 'linear-gradient(135deg, #f472b6 0%, #fb7185 60%, #fda4af 100%)',
    version: 'V4',
    previewImage: POLLO('Anime Style 3.jpg'),
  },
  {
    id: 'anime-style-2',
    name: '动漫风格 2',
    description: '少年漫画 · 高对比戏剧光',
    prompt: 'dark anime style 2, dramatic lighting, shonen manga, bold line work, high contrast',
    gradient: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 60%, #4338ca 100%)',
    version: 'V4',
    previewImage: POLLO('Anime Style 2.jpg'),
  },
  {
    id: 'anime-style-1',
    name: '动漫风格 1',
    description: '90年代经典 · 传统日本动画',
    prompt: 'classic anime style 1, retro 90s Japanese animation, hand-drawn look, bright colors',
    gradient: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 60%, #7dd3fc 100%)',
    version: 'V4',
    previewImage: POLLO('Anime Style 1.jpg'),
  },
  {
    id: 'pencil-style',
    name: '铅笔素描',
    description: '手绘铅笔 · 交叉阴影线条',
    prompt: 'pencil sketch style, detailed pencil drawing, cross-hatching, grayscale illustration',
    gradient: 'linear-gradient(135deg, #64748b 0%, #94a3b8 60%, #cbd5e1 100%)',
    version: 'V4',
    previewImage: POLLO('Pencil Style.jpg'),
  },
  {
    id: 'aquahue-anime',
    name: 'AquaHue动漫',
    description: '水彩动漫 · 流动色彩渲染',
    prompt: 'AquaHue anime style, watercolor anime aesthetic, fluid color washes, dreamy atmosphere',
    gradient: 'linear-gradient(135deg, #06b6d4 0%, #22d3ee 60%, #67e8f9 100%)',
    version: 'V4',
    previewImage: POLLO('AquaHue Anime.jpg'),
  },
  {
    id: 'knit-style',
    name: '针织风格',
    description: '毛线质感 · 纺织艺术风',
    prompt: 'knitted wool texture style, yarn art, cozy knit pattern, textile aesthetic, soft fibers',
    gradient: 'linear-gradient(135deg, #84cc16 0%, #a3e635 60%, #bef264 100%)',
    version: 'V4',
    previewImage: POLLO('Knit Style.jpg'),
  },
  {
    id: 'van-gogh',
    name: '梵高油画',
    description: '旋转笔触 · 后印象派油画',
    prompt: 'Van Gogh impressionist painting style, swirling brushstrokes, bold colors, Post-Impressionism',
    gradient: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 30%, #d97706 60%, #92400e 100%)',
    version: 'V4',
    previewImage: POLLO('Van Gogh Style.jpg'),
  },
  {
    id: 'watercolor',
    name: '水彩画',
    description: '透明水彩 · 纸张晕染纹理',
    prompt: 'watercolor painting style, soft washes, bleeding colors, paper texture, translucent layers',
    gradient: 'linear-gradient(135deg, #e879f9 0%, #c084fc 60%, #a78bfa 100%)',
    version: 'V4',
    previewImage: POLLO('Watercolor.jpg'),
  },
  {
    id: 'ink-painting',
    name: '水墨画',
    description: '传统水墨 · 极简禅意美学',
    prompt: 'Chinese ink wash painting style, sumi-e, monochrome brush strokes, minimalist traditional art',
    gradient: 'linear-gradient(135deg, #1f2937 0%, #374151 60%, #4b5563 100%)',
    version: 'V4',
    previewImage: '/api/v1/static/ff6979313e19.jpg',
  },
]

// ─── Models ──────────────────────────────────────────────────────────────────
// 与后端 create_video2video 的 model_id 分派一致:
//  - seedance   即时可用的 Doubao Seedance 多模态转绘(reference_video + reference_images)
//  - kling-omni Kling Omni 转绘(需 token 开通 kling 分组)
export const vid2vidModels: Vid2VidModel[] = [
  {
    id: 'seedance',
    name: 'Seedance 快速',
    provider: 'Doubao',
    quality: 4,
    speed: 'fast',
    credits: 150,
    description: '高性价比，即时可用',
  },
  {
    id: 'kling-omni',
    name: 'Kling Omni',
    provider: 'Kling AI',
    quality: 5,
    speed: 'fast',
    credits: 150,
    description: '最佳质量风格迁移（需开通）',
  },
]

// ─── Output count options ─────────────────────────────────────────────────────

export const outputCountOptions = [1, 2, 3, 4] as const
export type OutputCount = (typeof outputCountOptions)[number]

// ─── Aspect ratio & duration options ──────────────────────────────────────────

export const ratioOptions = [
  { id: '16:9', label: '横屏 16:9' },
  { id: '9:16', label: '竖屏 9:16' },
  { id: '1:1', label: '方形 1:1' },
] as const

export const durationOptions = [5, 10] as const

// ─── Sample videos (served from MinIO /api/v1/static) ─────────────────────────
// 注:Seedance 参考视频模式要求源视频时长 ≤15.2s;这里仅收录 ≤15s 的样例,避免上游报时长超限。
export const sampleVideos = [
  { id: 'sv2', name: '城市夜景', url: '/api/v1/static/2264b08fb2e4.mp4' },   // ~7s
  { id: 'sv4', name: '海边日落', url: '/api/v1/static/077f9c14e1e7.mp4' },   // ~14.4s
  { id: 'sv3', name: '山地驾驶', url: '/api/v1/static/57f68853a425.mp4' },   // ~15s
]
