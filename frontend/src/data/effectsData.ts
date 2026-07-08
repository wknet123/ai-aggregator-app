/**
 * AI Effects Data - Categories and Effects Definitions
 */

export interface EffectCategory {
  id: string
  name: string
  icon: string
  description: string
}

export interface Effect {
  id: string
  name: string
  category: string
  credits: number
  icon: string
  description: string
  inputType: 'image' | 'video'
  outputType: 'image' | 'video'
  requiresReference?: boolean
  /** 效果示例图(自托管、已验证可用的样例,用于展示该特效的风格效果) */
  sampleImage?: string
}

export const effectCategories: EffectCategory[] = [
  { id: 'viral', name: '病毒/社交', icon: 'flame', description: '社交媒体热门特效' },
  { id: 'physics', name: '物理效果', icon: 'atom', description: '物理变形特效' },
  { id: 'appearance', name: '外观变换', icon: 'sparkles', description: '改变人物外观' },
  { id: 'style', name: '风格转换', icon: 'palette', description: '艺术风格转换' },
  { id: 'enhance', name: '增强修复', icon: 'wand', description: '图像增强和修复' },
  { id: 'edit', name: '编辑工具', icon: 'scissors', description: '图像编辑工具' },
]

export const effects: Effect[] = [
  // Edit Category
  { id: 'remove-bg', name: '去背景', category: 'edit', credits: 20, icon: 'scissors', description: '智能去除图片背景', inputType: 'image', outputType: 'image' },
  { id: 'extend-image', name: '图像扩展', category: 'edit', credits: 40, icon: 'expand', description: 'AI扩展图像边界', inputType: 'image', outputType: 'image' },

  // Enhance Category
  { id: 'gfpgan', name: '人脸修复', category: 'enhance', credits: 30, icon: 'user-check', description: '修复模糊人脸', inputType: 'image', outputType: 'image' },
  { id: 'real-esrgan-4x', name: '超分辨率4x', category: 'enhance', credits: 50, icon: 'zoom-in', description: '图像放大4倍', inputType: 'image', outputType: 'image' },
  { id: 'real-esrgan-8x', name: '超分辨率8x', category: 'enhance', credits: 80, icon: 'zoom-in', description: '图像放大8倍', inputType: 'image', outputType: 'image' },
  { id: 'photo-restore', name: '老照片修复', category: 'enhance', credits: 50, icon: 'image-plus', description: '修复老旧照片', inputType: 'image', outputType: 'image' },
  { id: 'colorize', name: '黑白上色', category: 'enhance', credits: 40, icon: 'palette', description: '为黑白照片上色', inputType: 'image', outputType: 'image' },

  // Style Category
  { id: 'animegan', name: '动漫风格', category: 'style', credits: 40, icon: 'sparkles', description: '转换为日系动漫风格', inputType: 'image', outputType: 'image', sampleImage: '/api/v1/static/d2bec6e4e516.png' },
  { id: 'ghibli', name: '吉卜力风格', category: 'style', credits: 40, icon: 'cloud', description: '宫崎骏吉卜力风格', inputType: 'image', outputType: 'image', sampleImage: '/api/v1/static/ff8042c55de2.png' },
  { id: 'pixar', name: '皮克斯风格', category: 'style', credits: 50, icon: 'box', description: '皮克斯3D动画风格', inputType: 'image', outputType: 'image', sampleImage: '/api/v1/static/ac5e1b1b0909.png' },
  { id: 'sketch', name: '素描风格', category: 'style', credits: 30, icon: 'pencil', description: '转换为素描画', inputType: 'image', outputType: 'image' },

  // Viral/Social Category
  { id: 'faceswap', name: '换脸', category: 'viral', credits: 80, icon: 'users', description: 'AI换脸特效', inputType: 'image', outputType: 'image', requiresReference: true },
  { id: 'ai-kiss', name: 'AI亲吻', category: 'viral', credits: 100, icon: 'heart', description: '两人合成亲吻效果', inputType: 'image', outputType: 'video', requiresReference: true },
  { id: 'ai-hug', name: 'AI拥抱', category: 'viral', credits: 100, icon: 'hand-heart', description: '两人合成拥抱效果', inputType: 'image', outputType: 'video', requiresReference: true },

  // Appearance Category
  { id: 'make-younger', name: '变年轻', category: 'appearance', credits: 50, icon: 'baby', description: '让人物看起来更年轻', inputType: 'image', outputType: 'image' },
  { id: 'make-older', name: '变年老', category: 'appearance', credits: 50, icon: 'user', description: '让人物看起来更年老', inputType: 'image', outputType: 'image' },
  { id: 'add-beard', name: '加胡子', category: 'appearance', credits: 40, icon: 'user', description: '为人物添加胡子', inputType: 'image', outputType: 'image' },
  { id: 'makeup', name: 'AI化妆', category: 'appearance', credits: 40, icon: 'sparkle', description: 'AI智能化妆', inputType: 'image', outputType: 'image' },

  // Physics Category
  { id: 'ai-squish', name: 'AI挤压', category: 'physics', credits: 60, icon: 'move-vertical', description: '物体挤压变形效果', inputType: 'image', outputType: 'video' },
  { id: 'ai-inflate', name: 'AI膨胀', category: 'physics', credits: 60, icon: 'circle-dot', description: '物体膨胀效果', inputType: 'image', outputType: 'video' },
  { id: 'ai-melt', name: 'AI融化', category: 'physics', credits: 60, icon: 'droplets', description: '物体融化效果', inputType: 'image', outputType: 'video' },
  { id: 'ai-explode', name: 'AI爆炸', category: 'physics', credits: 80, icon: 'zap', description: '爆炸粒子效果', inputType: 'image', outputType: 'video' },
]

export const getEffectsByCategory = (categoryId: string): Effect[] => {
  return effects.filter(e => e.category === categoryId)
}

export const getEffectById = (effectId: string): Effect | undefined => {
  return effects.find(e => e.id === effectId)
}
