import { useEffect } from 'react'

const BASE_TITLE = 'AI创作平台'

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = title ? `${title} - ${BASE_TITLE}` : BASE_TITLE

    return () => {
      document.title = previousTitle
    }
  }, [title])
}

// Page title mappings
export const PAGE_TITLES: Record<string, string> = {
  '/': '首页',
  '/gallery': '我的作品',
  '/image-generation': 'AI图片生成',
  '/video-generation': 'AI视频生成',
  '/3d-models': '3D模型',
  '/credits': '我的积分',
  '/recharge': '充值中心',
  '/settings': '设置',
  '/agent-studio': '智能体工作室',
  '/pricing': '定价',
  '/login': '登录',
  '/register': '注册',
}
