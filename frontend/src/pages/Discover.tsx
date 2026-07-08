import { useState, useEffect, useMemo } from 'react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { googleService } from '../services/google.service'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Download, X, Play, ChevronDown, ImageIcon, Video, LayoutGrid, Compass } from 'lucide-react'

type TabType = 'all' | 'image' | 'video'
type SortType = 'latest' | 'oldest'

interface DiscoverItem {
  task_id: string
  prompt: string
  model_id: string
  task_type: 'image' | 'video'
  result_url: string
  parameters: any
  created_at: string
  user_id?: number
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


export default function Discover() {
  useDocumentTitle('发现')

  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [sortBy, setSortBy] = useState<SortType>('latest')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [items, setItems] = useState<DiscoverItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<DiscoverItem | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    loadDiscover()
  }, [activeTab])

  const loadDiscover = async () => {
    setLoading(true)
    try {
      if (activeTab === 'all') {
        // Load both images and videos
        const [images, videos] = await Promise.all([
          googleService.getPublicWorks('image', 50),
          googleService.getPublicWorks('video', 50)
        ])
        // Merge and sort by date
        const allItems = [...images, ...videos].sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        setItems(allItems)
      } else {
        const data = await googleService.getPublicWorks(activeTab, 50)
        setItems(data)
      }
    } catch (err) {
      console.error('Failed to load discover:', err)
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
    }
    return 0
  })

  const handleDownload = (url: string, filename: string) => {
    const link = document.createElement('a')
    link.href = googleService.getResultUrl(url)
    link.download = filename
    link.click()
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
            </div>

            {/* Sort Dropdown - Enhanced */}
            <div className="relative">
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1f] hover:bg-[#252530] rounded-full text-sm text-gray-300 transition-all border border-gray-700/50 hover:border-gray-600"
              >
                <span>{sortBy === 'latest' ? '最新' : '最早'}</span>
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
                </div>
              )}
            </div>
          </div>

          {/* Gallery Grid - Random Size Grid Layout */}
          {loading ? (
            <div className="flex items-center justify-center flex-1">
              <div className="text-center">
                <div className="inline-block w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-gray-500">加载中...</p>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 p-6 md:p-8">
              <div className="w-16 h-16 md:w-24 md:h-24 rounded-full bg-gradient-to-br from-pink-500/10 to-purple-500/10 flex items-center justify-center mb-4 md:mb-6 border border-pink-500/20">
                <Compass className="w-8 h-8 md:w-12 md:h-12 text-pink-500/50" strokeWidth={1} />
              </div>
              <p className="text-gray-300 text-base md:text-lg font-medium">
                暂无公开作品
              </p>
              <p className="text-gray-500 text-xs md:text-sm mt-2 text-center max-w-[280px]">
                等待用户分享他们的精彩创作
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-1.5 md:p-2 lg:p-3">
              {/* Dynamic Masonry Grid - Responsive columns via CSS */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1 md:gap-1.5 auto-rows-[140px] md:auto-rows-[160px] lg:auto-rows-[180px]">
                {sortedItems.map((item, index) => {
                  const span = itemSpans[index]
                  // On mobile, limit span to prevent overflow
                  const colSpan = span.colSpan
                  const rowSpan = span.rowSpan
                  const isLarge = colSpan === 2 && rowSpan === 2

                  return (
                    <div
                      key={item.task_id}
                      className={`
                        relative overflow-hidden rounded-md md:rounded-lg cursor-pointer group
                        ${colSpan === 2 ? 'col-span-2 md:col-span-2' : 'col-span-1'}
                        ${rowSpan === 2 ? 'row-span-2' : 'row-span-1'}
                      `}
                      onClick={() => setSelectedItem(item)}
                    >
                      {/* Media - Full Bleed */}
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
                          {/* Video Play Badge */}
                          <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2 flex items-center gap-1 px-1.5 py-0.5 md:px-2 md:py-1 bg-black/70 rounded-full backdrop-blur-sm">
                            <Play className="w-2.5 h-2.5 md:w-3 md:h-3 text-white" fill="white" />
                            <span className="text-[9px] md:text-[10px] text-white font-medium">视频</span>
                          </div>
                        </>
                      )}

                      {/* Gradient Overlay - Always visible at bottom */}
                      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

                      {/* Bottom Info - Model Badge */}
                      <div className="absolute bottom-0 left-0 right-0 p-1.5 md:p-2">
                        <div className="flex items-center justify-between">
                          <span className={`text-white font-medium truncate ${isLarge ? 'text-xs md:text-sm' : 'text-[10px] md:text-xs'}`}>
                            {item.model_id?.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'AI'}
                          </span>
                        </div>
                      </div>

                      {/* Hover Actions */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300">
                        <div className="absolute top-1.5 right-1.5 md:top-2 md:right-2 flex gap-1 md:gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(item.result_url, `${item.task_id}.${item.task_type === 'video' ? 'mp4' : 'jpg'}`) }}
                            className="w-7 h-7 md:w-8 md:h-8 flex items-center justify-center bg-white/90 hover:bg-white rounded-full transition-all shadow-lg"
                            title="下载"
                          >
                            <Download className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-800" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
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
                onClick={() => handleDownload(selectedItem.result_url, `${selectedItem.task_id}.jpg`)}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-[#1a1a1f] hover:bg-[#252530] rounded-full transition-all shadow-lg border border-gray-700/50"
                title="下载"
              >
                <Download className="w-5 h-5 text-gray-300" />
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
                onClick={() => handleDownload(selectedItem.result_url, `${selectedItem.task_id}.mp4`)}
                className="w-10 h-10 md:w-11 md:h-11 flex items-center justify-center bg-[#1a1a1f] hover:bg-[#252530] rounded-full transition-all shadow-lg border border-gray-700/50"
                title="下载"
              >
                <Download className="w-5 h-5 text-gray-300" />
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
