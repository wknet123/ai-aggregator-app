import { useState, useEffect, useMemo } from 'react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { googleService } from '../services/google.service'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Download, X, Star, Trash2, Play, Heart, ChevronDown, ImageIcon, Video, LayoutGrid, Sparkles, Globe, Lock } from 'lucide-react'
import { SHOWCASE_ROW1, SHOWCASE_ROW2, ShowcaseItem } from '../data/showcase'

const SHOWCASE_ITEMS: ShowcaseItem[] = [...SHOWCASE_ROW1, ...SHOWCASE_ROW2]

type TabType = 'all' | 'image' | 'video' | 'favorites'
type SortType = 'latest' | 'oldest' | 'favorites'

interface GalleryItem {
  task_id: string
  prompt: string
  model_id: string
  task_type: 'image' | 'video'
  result_url: string
  parameters: any
  is_favorite?: boolean
  is_public?: boolean
  created_at: string
}

// Dynamic span patterns based on total item count
const getSpanPattern = (index: number, totalItems: number): { colSpan: number; rowSpan: number } => {
  // For very few items, make them larger
  if (totalItems <= 3) {
    return { colSpan: 2, rowSpan: 2 }
  }
  if (totalItems <= 6) {
    const patterns = [
      { colSpan: 2, rowSpan: 2 },
      { colSpan: 1, rowSpan: 2 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 2, rowSpan: 1 },
      { colSpan: 1, rowSpan: 1 },
      { colSpan: 1, rowSpan: 2 },
    ]
    return patterns[index % patterns.length]
  }
  // For more items, use a varied pattern with feature items
  const patterns = [
    { colSpan: 2, rowSpan: 2 },  // Large feature
    { colSpan: 1, rowSpan: 1 },  // Small
    { colSpan: 1, rowSpan: 2 },  // Tall
    { colSpan: 1, rowSpan: 1 },  // Small
    { colSpan: 2, rowSpan: 1 },  // Wide
    { colSpan: 1, rowSpan: 1 },  // Small
    { colSpan: 1, rowSpan: 1 },  // Small
    { colSpan: 1, rowSpan: 2 },  // Tall
    { colSpan: 2, rowSpan: 2 },  // Large feature
    { colSpan: 1, rowSpan: 1 },  // Small
    { colSpan: 1, rowSpan: 1 },  // Small
    { colSpan: 2, rowSpan: 1 },  // Wide
  ]
  return patterns[index % patterns.length]
}


export default function Gallery() {
  useDocumentTitle('我的作品')

  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [sortBy, setSortBy] = useState<SortType>('latest')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    loadGallery()
  }, [activeTab])

  const loadGallery = async () => {
    setLoading(true)
    try {
      if (activeTab === 'favorites') {
        const data = await googleService.getFavorites()
        setItems(data)
      } else if (activeTab === 'all') {
        // Load both images and videos
        const [images, videos] = await Promise.all([
          googleService.getHistory('image', 50),
          googleService.getHistory('video', 50)
        ])
        // Merge and sort by date
        const allItems = [...images, ...videos].sort((a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        )
        setItems(allItems as GalleryItem[])
      } else {
        const data = await googleService.getHistory(activeTab, 50)
        setItems(data as GalleryItem[])
      }
    } catch (err) {
      console.error('Failed to load gallery:', err)
    } finally {
      setLoading(false)
    }
  }

  // Sort items
  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'latest') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    } else if (sortBy === 'oldest') {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    } else if (sortBy === 'favorites') {
      return (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0)
    }
    return 0
  })

  const handleDelete = async (taskId: string) => {
    if (!confirm('确定要删除这个作品吗？')) return
    
    try {
      await googleService.deleteTask(taskId)
      setItems(items.filter(item => item.task_id !== taskId))
    } catch (err) {
      console.error('Failed to delete:', err)
      alert('Failed to delete item')
    }
  }

  const handleDownload = (url: string, filename: string) => {
    const link = document.createElement('a')
    link.href = googleService.getResultUrl(url)
    link.download = filename
    link.click()
  }

  const handleToggleFavorite = async (taskId: string) => {
    try {
      const result = await googleService.toggleFavorite(taskId)
      // If we're in favorites tab and item was unfavorited, remove it from list
      if (activeTab === 'favorites' && !result.is_favorite) {
        setItems(prevItems => prevItems.filter(item => item.task_id !== taskId))
        setSelectedItem(null)
      } else {
        // Update local state
        setItems(prevItems => prevItems.map(item =>
          item.task_id === taskId
            ? { ...item, is_favorite: result.is_favorite }
            : item
        ))
        // Also update selectedItem if it's the same item
        setSelectedItem(prev => prev?.task_id === taskId
          ? { ...prev, is_favorite: result.is_favorite }
          : prev
        )
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
      alert('操作失败，请重试')
    }
  }

  const handleTogglePublic = async (taskId: string) => {
    try {
      const result = await googleService.togglePublic(taskId)
      // Update local state
      setItems(prevItems => prevItems.map(item =>
        item.task_id === taskId
          ? { ...item, is_public: result.is_public }
          : item
      ))
      // Also update selectedItem if it's the same item
      setSelectedItem(prev => prev?.task_id === taskId
        ? { ...prev, is_public: result.is_public }
        : prev
      )
    } catch (err) {
      console.error('Failed to toggle public:', err)
      alert('操作失败，请重试')
    }
  }

  // Generate dynamic spans based on item count
  const itemSpans = useMemo(() => {
    return sortedItems.map((_, index) => getSpanPattern(index, sortedItems.length))
  }, [sortedItems.length])

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)]">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 flex flex-col overflow-hidden">
          
          {/* Header with Tabs and Sort */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 md:px-6 lg:px-8 shrink-0">
            {/* Tabs - Pill Style matching AIWorkbench */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                className={`flex items-center gap-2 ${activeTab === 'all' ? 'tab-pill-active' : 'tab-pill-inactive'}`}
                onClick={() => setActiveTab('all')}
              >
                <LayoutGrid className="w-4 h-4" strokeWidth={1.5} />
                <span>全部</span>
              </button>
              <button
                className={`flex items-center gap-2 ${activeTab === 'video' ? 'tab-pill-active' : 'tab-pill-inactive'}`}
                onClick={() => setActiveTab('video')}
              >
                <Video className="w-4 h-4" strokeWidth={1.5} />
                <span>视频</span>
              </button>
              <button
                className={`flex items-center gap-2 ${activeTab === 'image' ? 'tab-pill-active' : 'tab-pill-inactive'}`}
                onClick={() => setActiveTab('image')}
              >
                <ImageIcon className="w-4 h-4" strokeWidth={1.5} />
                <span>图像</span>
              </button>
              <button
                className={`flex items-center gap-2 ${activeTab === 'favorites' ? 'tab-pill-active' : 'tab-pill-inactive'}`}
                onClick={() => setActiveTab('favorites')}
              >
                <Heart className="w-4 h-4" strokeWidth={1.5} />
                <span>收藏</span>
              </button>
            </div>

            {/* Sort Dropdown - Enhanced */}
            <div className="relative">
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1f] hover:bg-[#252530] rounded-full text-sm text-gray-300 transition-all border border-gray-700/50 hover:border-gray-600"
              >
                <span>{sortBy === 'latest' ? '最新' : sortBy === 'oldest' ? '最早' : '收藏优先'}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-2 bg-[#1a1a1f] rounded-xl border border-gray-800/50 shadow-xl z-20 min-w-[130px] overflow-hidden">
                  <button
                    onClick={() => { setSortBy('latest'); setShowSortMenu(false) }}
                    className={`w-full px-4 py-2.5 text-left text-sm hover:bg-[#252530] transition-all ${sortBy === 'latest' ? 'text-pink-400 bg-pink-500/10' : 'text-gray-300'}`}
                  >
                    最新
                  </button>
                  <button
                    onClick={() => { setSortBy('oldest'); setShowSortMenu(false) }}
                    className={`w-full px-4 py-2.5 text-left text-sm hover:bg-[#252530] transition-all ${sortBy === 'oldest' ? 'text-pink-400 bg-pink-500/10' : 'text-gray-300'}`}
                  >
                    最早
                  </button>
                  <button
                    onClick={() => { setSortBy('favorites'); setShowSortMenu(false) }}
                    className={`w-full px-4 py-2.5 text-left text-sm hover:bg-[#252530] transition-all ${sortBy === 'favorites' ? 'text-pink-400 bg-pink-500/10' : 'text-gray-300'}`}
                  >
                    收藏优先
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Main scrollable area */}
          <div className="flex-1 overflow-y-auto">

            {/* ── 精选作品（顶部，收藏 tab 除外）──────────────────────── */}
            {activeTab !== 'favorites' && (
              <div className="p-1.5 md:p-2 lg:p-3">
                <div className="flex items-center gap-2 px-1 pt-1 pb-3">
                  <Sparkles className="w-4 h-4 text-pink-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-white">精选作品</span>
                  <span className="text-xs text-gray-500">· Wan 2.7 · 海螺 Hailuo · Seedance</span>
                </div>
                <div className="grid grid-flow-dense grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 md:gap-1.5 auto-rows-[140px] md:auto-rows-[160px] lg:auto-rows-[180px]">
                  {SHOWCASE_ITEMS.map((item, index) => {
                    const span = getSpanPattern(index, SHOWCASE_ITEMS.length)
                    return (
                      <div
                        key={item.id}
                        className={`
                          relative overflow-hidden rounded-md md:rounded-lg group
                          ${span.colSpan === 2 ? 'col-span-2' : 'col-span-1'}
                          ${span.rowSpan === 2 ? 'row-span-2' : 'row-span-1'}
                        `}
                      >
                        {item.type === 'video' ? (
                          <video
                            src={item.url}
                            className="absolute inset-0 w-full h-full object-cover"
                            muted loop playsInline preload="metadata"
                            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                            onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
                          />
                        ) : (
                          <img
                            src={item.url}
                            alt={item.label}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                        {item.type === 'video' && (
                          <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 rounded-full backdrop-blur-sm">
                            <Play className="w-2.5 h-2.5 text-white" fill="white" />
                            <span className="text-[9px] text-white font-medium">视频</span>
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <p className="text-white text-xs font-medium truncate">{item.label}</p>
                          <p className="text-gray-300 text-[10px]">{item.model}</p>
                        </div>
                        <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-purple-500/70 rounded text-[9px] text-white backdrop-blur-sm font-medium">
                          精选
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── 分隔线 ──────────────────────────────────────────────── */}
            {activeTab !== 'favorites' && (
              <div className="mx-3 md:mx-4 my-1 border-t border-gray-800/60" />
            )}

            {/* ── 我的作品（底部）────────────────────────────────────── */}
            <div className="p-1.5 md:p-2 lg:p-3">
              {activeTab !== 'favorites' && (
                <div className="flex items-center gap-2 px-1 pt-2 pb-3">
                  <LayoutGrid className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-white">我的作品</span>
                  {!loading && (
                    <span className="text-xs text-gray-500">
                      {items.length > 0 ? `· ${items.length} 件` : '· 暂无作品'}
                    </span>
                  )}
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <div className="inline-block w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-gray-500 text-sm">加载中...</p>
                  </div>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 px-6">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500/10 to-purple-500/10 flex items-center justify-center mb-4 border border-pink-500/20">
                    {activeTab === 'favorites' ? (
                      <Heart className="w-7 h-7 text-pink-500/50" strokeWidth={1} />
                    ) : activeTab === 'video' ? (
                      <Video className="w-7 h-7 text-pink-500/50" strokeWidth={1} />
                    ) : activeTab === 'image' ? (
                      <ImageIcon className="w-7 h-7 text-pink-500/50" strokeWidth={1} />
                    ) : (
                      <Sparkles className="w-7 h-7 text-pink-500/50" strokeWidth={1} />
                    )}
                  </div>
                  <p className="text-gray-300 text-sm font-medium">
                    {activeTab === 'favorites' ? '暂无收藏' : '暂无作品，开始创作吧！'}
                  </p>
                  <p className="text-gray-600 text-xs mt-1 text-center max-w-[240px]">
                    {activeTab === 'favorites'
                      ? '点击作品上的爱心图标添加到收藏夹'
                      : '完成创作后，作品将在这里展示'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-flow-dense grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 md:gap-1.5 auto-rows-[140px] md:auto-rows-[160px] lg:auto-rows-[180px]">
                  {sortedItems.map((item, index) => {
                    const span = itemSpans[index]
                    const colSpan = span.colSpan
                    const rowSpan = span.rowSpan
                    const isLarge = colSpan === 2 && rowSpan === 2
                    return (
                      <div
                        key={item.task_id}
                        className={`
                          relative overflow-hidden rounded-md md:rounded-lg cursor-pointer group
                          ${colSpan === 2 ? 'col-span-2' : 'col-span-1'}
                          ${rowSpan === 2 ? 'row-span-2' : 'row-span-1'}
                        `}
                        onClick={() => setSelectedItem(item)}
                      >
                        {item.task_type === 'image' ? (
                          <img
                            src={googleService.getResultUrl(item.result_url)}
                            alt={item.prompt}
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect fill="%231a1a1f" width="100%" height="100%"/><text x="50%" y="50%" text-anchor="middle" fill="%236b7280" font-size="16">加载失败</text></svg>'
                            }}
                          />
                        ) : (
                          <>
                            <video
                              src={googleService.getResultUrl(item.result_url)}
                              className="absolute inset-0 w-full h-full object-cover"
                              preload="metadata"
                              muted
                              playsInline
                              onMouseEnter={(e) => e.currentTarget.play()}
                              onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
                            />
                            <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2 flex items-center gap-1 px-1.5 py-0.5 md:px-2 md:py-1 bg-black/70 rounded-full backdrop-blur-sm">
                              <Play className="w-2.5 h-2.5 md:w-3 md:h-3 text-white" fill="white" />
                              <span className="text-[9px] md:text-[10px] text-white font-medium">视频</span>
                            </div>
                          </>
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
                        <div className="absolute bottom-0 left-0 right-0 p-1.5 md:p-2">
                          <div className="flex items-center justify-between">
                            <span className={`text-white font-medium truncate ${isLarge ? 'text-xs md:text-sm' : 'text-[10px] md:text-xs'}`}>
                              {item.model_id?.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'AI'}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleToggleFavorite(item.task_id) }}
                              className="w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm hover:bg-pink-500/80 transition-all"
                            >
                              <Heart className={`w-3 h-3 md:w-3.5 md:h-3.5 ${item.is_favorite ? 'fill-pink-500 text-pink-500' : 'text-white'}`} />
                            </button>
                          </div>
                        </div>
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300">
                          <div className="absolute top-1.5 right-1.5 md:top-2 md:right-2 flex gap-1 md:gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleTogglePublic(item.task_id) }}
                              className={`w-7 h-7 md:w-8 md:h-8 flex items-center justify-center rounded-full transition-all shadow-lg ${item.is_public ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-600 hover:bg-gray-500'}`}
                              title={item.is_public ? "设为私有" : "公开分享"}
                            >
                              {item.is_public ? <Globe className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" /> : <Lock className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownload(item.result_url, `${item.task_id}.${item.task_type === 'video' ? 'mp4' : 'jpg'}`) }}
                              className="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center bg-white/90 hover:bg-white rounded-full transition-all shadow-lg"
                              title="下载"
                            >
                              <Download className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-800" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(item.task_id) }}
                              className="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center bg-red-500 hover:bg-red-600 rounded-full transition-all shadow-lg"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4 text-white" />
                            </button>
                          </div>
                        </div>
                        <div className="absolute top-1.5 right-1.5 md:top-2 md:right-2 flex gap-1 group-hover:opacity-0 transition-opacity">
                          {item.is_public && (
                            <div className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center bg-green-500 rounded-full shadow-lg">
                              <Globe className="w-2.5 h-2.5 md:w-3 md:h-3 text-white" />
                            </div>
                          )}
                          {item.is_favorite && (
                            <div className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center bg-pink-500 rounded-full shadow-lg">
                              <Heart className="w-2.5 h-2.5 md:w-3 md:h-3 text-white fill-white" />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>
        </main>
      </div>

      {/* Image Modal */}
      {selectedItem && selectedItem.task_type === 'image' && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div 
            className="relative flex flex-col items-center gap-3 max-w-full max-h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Action buttons - above the image */}
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => handleToggleFavorite(selectedItem.task_id)}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-[#1a1a1f] hover:bg-[#252530] rounded-full transition-all shadow-lg border border-gray-700/50"
                title={selectedItem.is_favorite ? "取消收藏" : "收藏"}
              >
                <Star className={`w-5 h-5 transition-colors ${selectedItem.is_favorite ? 'text-pink-500 fill-pink-500' : 'text-gray-400'}`} />
              </button>
              <button
                onClick={() => handleTogglePublic(selectedItem.task_id)}
                className={`w-10 h-10 md:w-11 md:h-11 flex items-center justify-center rounded-full transition-all shadow-lg border ${selectedItem.is_public ? 'bg-green-500/20 hover:bg-green-500/30 border-green-500/50' : 'bg-[#1a1a1f] hover:bg-[#252530] border-gray-700/50'}`}
                title={selectedItem.is_public ? "设为私有" : "公开分享"}
              >
                {selectedItem.is_public ? (
                  <Globe className="w-5 h-5 text-green-400" />
                ) : (
                  <Lock className="w-5 h-5 text-gray-400" />
                )}
              </button>
              <button
                onClick={() => handleDownload(selectedItem.result_url, `${selectedItem.task_id}.jpg`)}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-[#1a1a1f] hover:bg-[#252530] rounded-full transition-all shadow-lg border border-gray-700/50"
                title="下载"
              >
                <Download className="w-5 h-5 text-gray-300" />
              </button>
              <button
                onClick={() => { handleDelete(selectedItem.task_id); setSelectedItem(null); }}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-red-500/20 hover:bg-red-500/30 rounded-full transition-all shadow-lg border border-red-500/50"
                title="删除"
              >
                <Trash2 className="w-5 h-5 text-red-400" />
              </button>
              <button
                onClick={() => setSelectedItem(null)}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 rounded-full transition-all shadow-lg"
                title="关闭"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            <img
              src={googleService.getResultUrl(selectedItem.result_url)}
              alt="全尺寸预览"
              className="max-w-full max-h-[calc(100vh-120px)] object-contain rounded-xl border border-gray-800/50"
            />
          </div>
        </div>
      )}

      {/* Video Modal */}
      {selectedItem && selectedItem.task_type === 'video' && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div 
            className="relative flex flex-col items-center gap-3 max-w-4xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Action buttons - above the video */}
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => handleToggleFavorite(selectedItem.task_id)}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-[#1a1a1f] hover:bg-[#252530] rounded-full transition-all shadow-lg border border-gray-700/50"
                title={selectedItem.is_favorite ? "取消收藏" : "收藏"}
              >
                <Star className={`w-5 h-5 transition-colors ${selectedItem.is_favorite ? 'text-pink-500 fill-pink-500' : 'text-gray-400'}`} />
              </button>
              <button
                onClick={() => handleTogglePublic(selectedItem.task_id)}
                className={`w-10 h-10 md:w-11 md:h-11 flex items-center justify-center rounded-full transition-all shadow-lg border ${selectedItem.is_public ? 'bg-green-500/20 hover:bg-green-500/30 border-green-500/50' : 'bg-[#1a1a1f] hover:bg-[#252530] border-gray-700/50'}`}
                title={selectedItem.is_public ? "设为私有" : "公开分享"}
              >
                {selectedItem.is_public ? (
                  <Globe className="w-5 h-5 text-green-400" />
                ) : (
                  <Lock className="w-5 h-5 text-gray-400" />
                )}
              </button>
              <button
                onClick={() => handleDownload(selectedItem.result_url, `${selectedItem.task_id}.mp4`)}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-[#1a1a1f] hover:bg-[#252530] rounded-full transition-all shadow-lg border border-gray-700/50"
                title="下载"
              >
                <Download className="w-5 h-5 text-gray-300" />
              </button>
              <button
                onClick={() => { handleDelete(selectedItem.task_id); setSelectedItem(null); }}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-red-500/20 hover:bg-red-500/30 rounded-full transition-all shadow-lg border border-red-500/50"
                title="删除"
              >
                <Trash2 className="w-5 h-5 text-red-400" />
              </button>
              <button
                onClick={() => setSelectedItem(null)}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 rounded-full transition-all shadow-lg"
                title="关闭"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            {/* Video container with border */}
            <div className="rounded-2xl overflow-hidden border-2 border-pink-500/30 shadow-2xl shadow-pink-500/10 bg-black">
              <video
                src={googleService.getResultUrl(selectedItem.result_url)}
                className="w-full h-auto max-h-[calc(100vh-120px)] object-contain"
                controls
                autoPlay
                playsInline
              />
            </div>
            
            {/* Decorative glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-pink-500 via-purple-500 to-pink-500 rounded-2xl opacity-10 blur-xl -z-10 pointer-events-none" style={{top: '50px'}}></div>
          </div>
        </div>
      )}
    </div>
  )
}
