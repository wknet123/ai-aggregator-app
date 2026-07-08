/**
 * Curated AI-generated showcase items for the portal gallery.
 * All URLs verified 200 OK from public CDNs (Luma, Kling, Pollo, Pexels, Unsplash).
 */

export interface ShowcaseItem {
  id: string
  type: 'image' | 'video'
  url: string
  label: string
  model: string
}

/** First marquee row — scrolls left (18 items) */
export const SHOWCASE_ROW1: ShowcaseItem[] = [
  {
    id: 'v1',
    type: 'video',
    url: '/api/v1/static/464663a48de8.mp4',
    label: '电影级光影',
    model: '海螺 Hailuo',
  },
  {
    id: 'i1',
    type: 'image',
    url: '/api/v1/static/27289616a24a.png',
    label: '黏土动画',
    model: 'Wan 2.7',
  },
  {
    id: 'v2',
    type: 'video',
    url: '/api/v1/static/c7d764e94f29.mp4',
    label: '写实场景',
    model: '海螺 Hailuo',
  },
  {
    id: 'i2',
    type: 'image',
    url: '/api/v1/static/ff8042c55de2.png',
    label: '吉卜力风格',
    model: 'Wan 2.7',
  },
  {
    id: 'v3',
    type: 'video',
    url: '/api/v1/static/afaa68a13daa.mp4',
    label: '动漫奇幻',
    model: '海螺 Hailuo',
  },
  {
    id: 'p1',
    type: 'image',
    url: '/api/v1/static/96a2fef6f335.jpeg?w=600',
    label: '科幻场景',
    model: 'AI 生成',
  },
  {
    id: 'v4',
    type: 'video',
    url: '/api/v1/static/f136a18fe198.mp4',
    label: '动态特写',
    model: '海螺 Hailuo',
  },
  {
    id: 'i4',
    type: 'image',
    url: '/api/v1/static/ff6979313e19.jpg',
    label: '水墨画风',
    model: 'Wan 2.7',
  },
  {
    id: 'l1',
    type: 'image',
    url: '/api/v1/static/4b80fd2a80ad.jpg',
    label: '光影艺术',
    model: 'Wan 2.7',
  },
  {
    id: 'p2',
    type: 'image',
    url: '/api/v1/static/904c05c00b1c.jpeg?w=600',
    label: '霓虹都市',
    model: 'AI 生成',
  },
  {
    id: 'v5',
    type: 'video',
    url: '/api/v1/static/caa5bca34ae8.mp4',
    label: 'AI创意',
    model: '海螺 Hailuo',
  },
  {
    id: 'i5',
    type: 'image',
    url: '/api/v1/static/d2bec6e4e516.png',
    label: '动漫风格',
    model: 'Wan 2.7',
  },
  {
    id: 'l2',
    type: 'image',
    url: '/api/v1/static/a56928bbfcdf.jpg',
    label: '概念艺术',
    model: 'Wan 2.7',
  },
  {
    id: 'p3',
    type: 'image',
    url: '/api/v1/static/da11b2e68962.jpeg?w=600',
    label: '星云宇宙',
    model: 'AI 生成',
  },
  {
    id: 'i3',
    type: 'image',
    url: '/api/v1/static/8d58a778a001.png',
    label: '文生图精品',
    model: 'Wan 2.7',
  },
  {
    id: 'vl1',
    type: 'video',
    url: '/api/v1/static/7ee85947a3eb.mp4',
    label: '视觉特效',
    model: '海螺 Hailuo',
  },
  {
    id: 'p4',
    type: 'image',
    url: '/api/v1/static/a56fe4dfa05a.jpeg?w=600',
    label: '抽象几何',
    model: 'AI 生成',
  },
  {
    id: 'u1',
    type: 'image',
    url: '/api/v1/static/5175cc58a5b5.jpg',
    label: 'AI艺术',
    model: 'AI 生成',
  },
]

/** Second marquee row — scrolls right (18 items) */
export const SHOWCASE_ROW2: ShowcaseItem[] = [
  {
    id: 'v6',
    type: 'video',
    url: '/api/v1/static/9579ee6616e8.mp4',
    label: '震撼特效',
    model: '海螺 Hailuo',
  },
  {
    id: 'i6',
    type: 'image',
    url: '/api/v1/static/9382e574d291.jpg',
    label: '梵高油画',
    model: 'Wan 2.7',
  },
  {
    id: 'v7',
    type: 'video',
    url: '/api/v1/static/abf6708263c7.mp4',
    label: '场景扩展',
    model: '海螺 Hailuo',
  },
  {
    id: 'i7',
    type: 'image',
    url: '/api/v1/static/20bdc9ea4627.jpg',
    label: '水彩画风',
    model: 'Wan 2.7',
  },
  {
    id: 'l3',
    type: 'image',
    url: '/api/v1/static/550d5497443f.jpg',
    label: '创意视觉',
    model: 'Wan 2.7',
  },
  {
    id: 'v8',
    type: 'video',
    url: '/api/v1/static/97fb1298034e.mp4',
    label: '商业广告',
    model: '海螺 Hailuo',
  },
  {
    id: 'p5',
    type: 'image',
    url: '/api/v1/static/70f8bddebd90.jpeg?w=600',
    label: '壮阔山河',
    model: 'AI 生成',
  },
  {
    id: 'i8',
    type: 'image',
    url: '/api/v1/static/ac5e1b1b0909.png',
    label: '皮克斯风格',
    model: 'Wan 2.7',
  },
  {
    id: 'l4',
    type: 'image',
    url: '/api/v1/static/632a047ae4f6.jpg',
    label: '未来世界',
    model: 'Wan 2.7',
  },
  {
    id: 'v9',
    type: 'video',
    url: '/api/v1/static/368fadafcc01.mp4',
    label: '创意影像',
    model: '海螺 Hailuo',
  },
  {
    id: 'p6',
    type: 'image',
    url: '/api/v1/static/a9865864eb38.jpeg?w=600',
    label: '深空探索',
    model: 'AI 生成',
  },
  {
    id: 'i9',
    type: 'image',
    url: '/api/v1/static/0d1c2813a3a4.jpg',
    label: 'GPT动漫',
    model: 'Wan 2.7',
  },
  {
    id: 'l5',
    type: 'image',
    url: '/api/v1/static/1d15f2bbb8e9.jpg',
    label: '艺术摄影',
    model: 'Wan 2.7',
  },
  {
    id: 'v10',
    type: 'video',
    url: '/api/v1/static/ce79801bcd5d.mp4',
    label: '游戏世界',
    model: '海螺 Hailuo',
  },
  {
    id: 'p7',
    type: 'image',
    url: '/api/v1/static/f3550900b478.jpeg?w=600',
    label: '流体抽象',
    model: 'AI 生成',
  },
  {
    id: 'i10',
    type: 'image',
    url: '/api/v1/static/587e340b7638.png',
    label: '图像精修',
    model: 'Wan 2.7',
  },
  {
    id: 'l6',
    type: 'image',
    url: '/api/v1/static/bec01d041772.jpg',
    label: '场景设计',
    model: 'Wan 2.7',
  },
  {
    id: 'u2',
    type: 'image',
    url: '/api/v1/static/c69addbd6c94.jpg',
    label: '赛博朋克',
    model: 'AI 生成',
  },
]
