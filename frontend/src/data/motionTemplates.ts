/**
 * Motion Templates Data for 动作模仿 (Motion Imitation) Feature.
 * 模板视频均托管于 MinIO public/static/,经 /api/v1/static/{hash}.mp4 代理(已验证可用)。
 */

export interface MotionCategory {
  id: string
  name: string
  icon: string
}

export interface MotionTemplate {
  id: string
  category: string
  name: string
  duration: string
  badge?: 'HOT' | 'NEW' | null
  previewUrl: string
  thumbnailUrl?: string
}

export interface MotionModel {
  id: string
  name: string
  provider: string
  trueMimic: boolean
  credits: number
  processingTime: string
  description: string
}

export const motionCategories: MotionCategory[] = [
  { id: 'trending', name: '热门', icon: '🔥' },
  { id: 'dance', name: '舞蹈', icon: '💃' },
  { id: 'action', name: '动作', icon: '🏃' },
  { id: 'gesture', name: '手势', icon: '👋' },
  { id: 'funny', name: '搞笑', icon: '😄' },
  { id: 'custom', name: '自定义', icon: '🎬' },
]

export const motionTemplates: MotionTemplate[] = [
  // ── Trending ──
  { id: 'tiktok-dance', category: 'trending', name: 'TikTok热舞', duration: '10s', badge: 'HOT', previewUrl: '/api/v1/static/f9dd50d0cd1d.mp4' },
  { id: 'silhouette-dance', category: 'trending', name: '剪影热舞', duration: '10s', badge: 'HOT', previewUrl: '/api/v1/static/d517ad8e8828.mp4' },
  { id: 'colorful-dance', category: 'trending', name: '炫彩舞蹈', duration: '12s', badge: 'NEW', previewUrl: '/api/v1/static/022976843db7.mp4' },
  { id: 'martial-arts', category: 'trending', name: '武术表演', duration: '10s', badge: null, previewUrl: '/api/v1/static/7802f148e9b7.mp4' },

  // ── Dance ──
  { id: 'breakdance-1', category: 'dance', name: '街舞 Breaking', duration: '8s', badge: 'HOT', previewUrl: '/api/v1/static/eefc41438042.mp4' },
  { id: 'breakdance-2', category: 'dance', name: '地板动作', duration: '8s', badge: null, previewUrl: '/api/v1/static/0eba2f9b412e.mp4' },
  { id: 'breakdance-3', category: 'dance', name: '自由街舞', duration: '10s', badge: null, previewUrl: '/api/v1/static/0e0956e7f544.mp4' },
  { id: 'contemporary', category: 'dance', name: '现代舞', duration: '8s', badge: 'NEW', previewUrl: '/api/v1/static/b87a12268cc9.mp4' },
  { id: 'silhouette-girl', category: 'dance', name: '动感热舞', duration: '10s', badge: null, previewUrl: '/api/v1/static/9acc44ee4081.mp4' },
  { id: 'night-choreo', category: 'dance', name: '夜间编舞', duration: '8s', badge: null, previewUrl: '/api/v1/static/79045375d0b1.mp4' },
  { id: 'group-choreo', category: 'dance', name: '团队编舞', duration: '8s', badge: null, previewUrl: '/api/v1/static/c8fdef70f280.mp4' },
  { id: 'smoke-dance', category: 'dance', name: '烟雾热舞', duration: '8s', badge: 'HOT', previewUrl: '/api/v1/static/58648a0e144c.mp4' },

  // ── Action ──
  { id: 'upside-down', category: 'action', name: '倒立舞', duration: '6s', badge: null, previewUrl: '/api/v1/static/2f44088d509d.mp4' },
  { id: 'street-move', category: 'action', name: '街头动作', duration: '6s', badge: null, previewUrl: '/api/v1/static/96408ad01abd.mp4' },
  { id: 'masked-dance', category: 'action', name: '面具舞者', duration: '6s', badge: 'NEW', previewUrl: '/api/v1/static/c8a172fa4ac8.mp4' },
  { id: 'rooftop-dance', category: 'action', name: '天台舞', duration: '8s', badge: 'HOT', previewUrl: '/api/v1/static/340eaac8a241.mp4' },
  { id: 'celebrate', category: 'action', name: '庆祝动作', duration: '6s', badge: null, previewUrl: '/api/v1/static/993ae024a9b6.mp4' },
  { id: 'dread-dance', category: 'action', name: '力量街舞', duration: '8s', badge: null, previewUrl: '/api/v1/static/2ab3ca72f141.mp4' },

  // ── Gesture ──
  { id: 'thumbs-up', category: 'gesture', name: '竖大拇指', duration: '4s', badge: null, previewUrl: '/api/v1/static/fbe3156f5cfb.mp4' },
  { id: 'wave', category: 'gesture', name: '挥手', duration: '5s', badge: null, previewUrl: '/api/v1/static/15b1062540f9.mp4' },
  { id: 'clap', category: 'gesture', name: '鼓掌', duration: '6s', badge: 'HOT', previewUrl: '/api/v1/static/345316a08a30.mp4' },
  { id: 'hands-up', category: 'gesture', name: '举手欢呼', duration: '5s', badge: null, previewUrl: '/api/v1/static/e6623e0fa2cd.mp4' },
  { id: 'success', category: 'gesture', name: '成功手势', duration: '6s', badge: 'NEW', previewUrl: '/api/v1/static/2cbd078dce46.mp4' },

  // ── Funny ──
  { id: 'horse-dance', category: 'funny', name: '马头舞', duration: '6s', badge: 'HOT', previewUrl: '/api/v1/static/c7e6fc66d583.mp4' },
  { id: 'suit-dance', category: 'funny', name: '西装热舞', duration: '6s', badge: null, previewUrl: '/api/v1/static/c8e132ccfc82.mp4' },
  { id: 'cat-dance', category: 'funny', name: '猫咪蹦迪', duration: '6s', badge: 'NEW', previewUrl: '/api/v1/static/3ef1a384c27b.mp4' },
  { id: 'money-rain', category: 'funny', name: '撒钱舞', duration: '8s', badge: null, previewUrl: '/api/v1/static/b6e725cf7f57.mp4' },
  { id: 'flower-dance', category: 'funny', name: '花丛起舞', duration: '6s', badge: null, previewUrl: '/api/v1/static/d28633eb2f18.mp4' },
]

// 三档模型:与后端 create_motion 的 model_id 分派一致。
//  - kling-motion-control / kling-omni 走 Kling 端点(需 token 开通 kling 分组)
//  - seedance 为即时可用的回退档(Doubao Seedance 多模态)
export const motionModels: MotionModel[] = [
  {
    id: 'seedance',
    name: 'Seedance 快速',
    provider: 'Doubao',
    trueMimic: false,
    credits: 150,
    processingTime: '3-5 min',
    description: '快速动作生成，即时可用',
  },
  {
    id: 'kling-motion-control',
    name: 'Kling 动作控制',
    provider: 'Kling AI',
    trueMimic: true,
    credits: 150,
    processingTime: '5 min',
    description: '真实动作迁移，效果最佳（需开通）',
  },
  {
    id: 'kling-omni',
    name: 'Kling Omni',
    provider: 'Kling AI',
    trueMimic: true,
    credits: 150,
    processingTime: '5 min',
    description: '多模态动作生成（需开通）',
  },
]

export const getTemplatesByCategory = (categoryId: string): MotionTemplate[] => {
  if (categoryId === 'custom') return []
  return motionTemplates.filter(t => t.category === categoryId)
}

export const getTemplateById = (templateId: string): MotionTemplate | undefined => {
  return motionTemplates.find(t => t.id === templateId)
}
