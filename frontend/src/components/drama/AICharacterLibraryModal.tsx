/**
 * AICharacterLibraryModal – AI 角色库浏览 & 选择弹窗。
 *
 * 排版对标参考图：
 *   浏览页（main.png）：左侧多级分类导航树 + 顶部面包屑 + 顶部属性筛选 chips + 角色卡片网格
 *   详情页（detail.png）：左侧 1/2/3/4 号图「从左上顺时针」四宫格 + 右侧角色属性 / 辨识特征 /
 *                        着装描述 + 底部「应用到画布」；支持上一个/下一个切换
 *
 * 选中「应用到画布」→ 调 aiCharacterService.applyToProject 实例化为当前项目的可编辑角色要素。
 * AI 角色定义全局只读；此弹窗不提供任何增删改。
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  X, Loader2, ImageIcon, Search, ChevronDown, ChevronRight, ChevronLeft,
  Check, Sparkles, Filter,
} from 'lucide-react'
import {
  aiCharacterService,
  AICharacterCategoryNode, AICharacterCard, AICharacterDetail,
} from '../../services/ai-character.service'

// 卡片副标题使用的属性维度顺序（对标 main.png 卡片下方「男 · 中年 · 壮硕 · 威严」）
const CARD_ATTRS = ['性别', '年龄段', '体格', '气质']
// slot → detail.png 图片语义标签
const SLOT_LABEL: Record<number, string> = {
  1: '角色立绘', 2: '肖像特写', 3: '表情九宫格', 4: '三视图',
}

export default function AICharacterLibraryModal({
  projectId, onClose, onApplied,
}: {
  projectId: string
  onClose: () => void
  onApplied: (assetName: string) => void
}) {
  const [tree, setTree] = useState<AICharacterCategoryNode[]>([])
  const [total, setTotal] = useState(0)
  const [activePath, setActivePath] = useState<string | null>(null)   // 选中分类；null=全部
  const [q, setQ] = useState('')
  const [filterValues, setFilterValues] = useState<Record<string, string[]>>({})
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string[]>>({})  // 已选筛选值
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null)

  const [cards, setCards] = useState<AICharacterCard[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [detailKey, setDetailKey] = useState<string | null>(null)   // 打开详情弹窗的角色

  // 分类树 + 筛选维度
  useEffect(() => {
    aiCharacterService.listCategories().then(r => { setTree(r.tree); setTotal(r.total) }).catch(() => {})
  }, [])
  useEffect(() => {
    aiCharacterService.listFilters(activePath || undefined)
      .then(r => setFilterValues(r.values)).catch(() => {})
  }, [activePath])

  const loadCards = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await aiCharacterService.listCharacters({
        categoryPath: activePath || undefined,
        q: q || undefined,
        filters: selectedFilters,
        limit: 200,
      })
      setCards(r.items); setListTotal(r.total)
    } catch (e: any) {
      setError(e?.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [activePath, q, selectedFilters])

  useEffect(() => {
    const t = setTimeout(loadCards, q ? 300 : 0)   // 搜索防抖
    return () => clearTimeout(t)
  }, [loadCards, q])

  const toggleFilter = (key: string, val: string) => {
    setSelectedFilters(prev => {
      const cur = prev[key] || []
      const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val]
      const copy = { ...prev }
      if (next.length) copy[key] = next; else delete copy[key]
      return copy
    })
  }
  const clearFilters = () => setSelectedFilters({})
  const activeFilterCount = Object.values(selectedFilters).reduce((n, v) => n + v.length, 0)

  // 面包屑：全部角色 > 分类路径逐级
  const breadcrumb = useMemo(() => {
    const parts = activePath ? activePath.split('/') : []
    return parts.map((_, i) => ({ label: parts[i], path: parts.slice(0, i + 1).join('/') }))
  }, [activePath])

  const detailIndex = detailKey ? cards.findIndex(c => c.character_key === detailKey) : -1
  const gotoDetail = (delta: number) => {
    if (detailIndex < 0) return
    const ni = detailIndex + delta
    if (ni >= 0 && ni < cards.length) setDetailKey(cards[ni].character_key)
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0b0b12]">
      {/* 头部 */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/5">
        <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-400" />AI角色库
          <span className="text-xs font-normal text-gray-600 ml-1">{total} 个角色</span>
        </h2>
        <button onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-400">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* 左：分类导航树 */}
        <div className="w-56 flex-shrink-0 border-r border-white/5 overflow-y-auto py-3 px-2">
          <button onClick={() => setActivePath(null)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium mb-1 ${
              activePath === null ? 'bg-indigo-500/15 text-indigo-200' : 'text-gray-400 hover:bg-white/[0.04]'}`}>
            全部角色
          </button>
          {tree.map(node => (
            <CategoryTreeNode key={node.id} node={node} depth={0}
              activePath={activePath} onSelect={setActivePath} />
          ))}
        </div>

        {/* 右：主区 */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* 面包屑 + 搜索 */}
          <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-white/5">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 flex-1 min-w-0 overflow-hidden">
              <button onClick={() => setActivePath(null)} className="hover:text-gray-300 whitespace-nowrap">全部角色</button>
              {breadcrumb.map(b => (
                <span key={b.path} className="flex items-center gap-1.5 min-w-0">
                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                  <button onClick={() => setActivePath(b.path)}
                    className="hover:text-gray-300 truncate">{b.label}</button>
                </span>
              ))}
            </div>
            <div className="relative flex-shrink-0">
              <Search className="w-3.5 h-3.5 text-gray-600 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索角色名…"
                className="w-48 pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/40" />
            </div>
          </div>

          {/* 属性筛选 chips（对标 main.png 顶部 + 性别 / 年龄段 …） */}
          <div className="flex-shrink-0 flex items-center gap-2 px-6 py-2.5 border-b border-white/5 flex-wrap">
            {Object.entries(filterValues).map(([key, vals]) => {
              if (!vals || vals.length === 0) return null
              const chosen = selectedFilters[key] || []
              const open = openFilterKey === key
              return (
                <div key={key} className="relative">
                  <button onClick={() => setOpenFilterKey(open ? null : key)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      chosen.length ? 'bg-indigo-500/15 text-indigo-200 border-indigo-500/30'
                      : 'bg-white/[0.03] text-gray-400 border-white/10 hover:border-white/25'}`}>
                    {chosen.length ? `${key}·${chosen.length}` : key}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {open && (
                    <div className="absolute z-10 mt-1 min-w-[140px] max-h-64 overflow-y-auto bg-[#1a1a24] border border-white/10 rounded-xl p-1.5 shadow-xl">
                      {vals.map(v => {
                        const on = chosen.includes(v)
                        return (
                          <button key={v} onClick={() => toggleFilter(key, v)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-gray-300 hover:bg-white/[0.06]">
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                              on ? 'bg-indigo-500 border-indigo-500' : 'border-white/25'}`}>
                              {on && <Check className="w-2.5 h-2.5 text-white" />}
                            </span>
                            {v}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            {activeFilterCount > 0 && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs text-gray-500 hover:text-gray-300">
                <Filter className="w-3 h-3" />清除筛选({activeFilterCount})
              </button>
            )}
          </div>

          {/* 卡片网格 */}
          <div className="flex-1 overflow-y-auto p-6 min-h-0"
            onClick={() => setOpenFilterKey(null)}>
            {loading ? (
              <div className="flex items-center justify-center py-24 text-gray-600 text-sm gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />加载中…
              </div>
            ) : error ? (
              <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2 inline-block">{error}</p>
            ) : cards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <ImageIcon className="w-10 h-10 text-gray-700 mb-3" />
                <p className="text-sm text-gray-500">没有符合条件的角色</p>
              </div>
            ) : (
              <>
                <div className="text-xs text-gray-600 mb-3">共 {listTotal} 个角色</div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
                  {cards.map(card => (
                    <CharacterCard key={card.character_key} card={card}
                      onClick={() => setDetailKey(card.character_key)} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 详情弹窗 */}
      {detailKey && (
        <CharacterDetailModal
          characterKey={detailKey}
          projectId={projectId}
          hasPrev={detailIndex > 0}
          hasNext={detailIndex >= 0 && detailIndex < cards.length - 1}
          onPrev={() => gotoDetail(-1)}
          onNext={() => gotoDetail(1)}
          onClose={() => setDetailKey(null)}
          onApplied={(name) => { setDetailKey(null); onApplied(name) }}
        />
      )}
    </div>
  )
}

// ── 分类树节点（递归） ─────────────────────────────────────────────────────────
function CategoryTreeNode({
  node, depth, activePath, onSelect,
}: {
  node: AICharacterCategoryNode
  depth: number
  activePath: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children && node.children.length > 0
  const active = activePath === node.path
  return (
    <div>
      <div className="flex items-center">
        {hasChildren ? (
          <button onClick={() => setOpen(o => !o)}
            className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-gray-300 flex-shrink-0">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : <span className="w-5 flex-shrink-0" />}
        <button onClick={() => onSelect(node.path)}
          style={{ paddingLeft: `${depth * 4}px` }}
          className={`flex-1 text-left px-2 py-1.5 rounded-lg text-sm truncate ${
            active ? 'bg-indigo-500/15 text-indigo-200 font-medium' : 'text-gray-400 hover:bg-white/[0.04]'}`}>
          {node.name}
          <span className="text-[10px] text-gray-600 ml-1">{node.count}</span>
        </button>
      </div>
      {hasChildren && open && (
        <div className="ml-2">
          {node.children.map(child => (
            <CategoryTreeNode key={child.id} node={child} depth={depth + 1}
              activePath={activePath} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 角色卡片 ───────────────────────────────────────────────────────────────
function CharacterCard({ card, onClick }: { card: AICharacterCard; onClick: () => void }) {
  const sub = CARD_ATTRS.map(k => card.attributes[k]).filter(Boolean).join(' · ')
  return (
    <div onClick={onClick}
      className="rounded-xl overflow-hidden border border-white/8 bg-white/[0.02] cursor-pointer hover:border-indigo-400/50 hover:bg-white/[0.04] transition-colors group">
      <div className="aspect-[3/4] bg-black/40 overflow-hidden">
        {card.cover_image_id != null
          ? <img src={aiCharacterService.imageUrl(card.character_key, card.cover_image_id)}
              alt={card.name} loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-6 h-6 text-gray-700" /></div>}
      </div>
      <div className="p-2.5">
        <div className="text-sm font-medium text-gray-100 truncate">{card.name}</div>
        <div className="text-[11px] text-gray-500 truncate mt-0.5">{sub || '—'}</div>
      </div>
    </div>
  )
}

// ── 详情弹窗（对标 detail.png） ─────────────────────────────────────────────
function CharacterDetailModal({
  characterKey, projectId, hasPrev, hasNext, onPrev, onNext, onClose, onApplied,
}: {
  characterKey: string
  projectId: string
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onApplied: (name: string) => void
}) {
  const [detail, setDetail] = useState<AICharacterDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    aiCharacterService.getCharacter(characterKey)
      .then(d => { if (alive) setDetail(d) })
      .catch(e => { if (alive) setErr(e?.response?.data?.detail || '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [characterKey])

  const apply = async () => {
    if (!detail) return
    setApplying(true); setErr('')
    try {
      const asset = await aiCharacterService.applyToProject({ projectId, characterKey })
      onApplied(asset.name)
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '应用失败')
      setApplying(false)
    }
  }

  // 「从左上顺时针」：1 左上 / 2 右上 / 3 右下 / 4 左下
  const bySlot = (n: number) => detail?.images.find(i => i.slot === n) || null
  const quadrants = [1, 2, 3, 4]

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-[#14141c] rounded-2xl border border-white/10 w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-white/5">
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <h3 className="text-base font-bold text-gray-100 truncate">{detail?.name || '…'}</h3>
            <span className="text-xs text-gray-600 truncate">{detail?.path?.replace(/\//g, ' · ')}</span>
          </div>
          <button onClick={onPrev} disabled={!hasPrev}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={onNext} disabled={!hasNext}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32 text-gray-600 gap-2"><Loader2 className="w-5 h-5 animate-spin" />加载中…</div>
        ) : !detail ? (
          <div className="py-32 text-center text-red-400 text-sm">{err || '角色不存在'}</div>
        ) : (
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* 左：1/2/3/4 从左上顺时针四宫格 */}
            <div className="flex-1 min-w-0 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-3">
                {quadrants.map(slot => {
                  const img = bySlot(slot)
                  return (
                    <div key={slot} className="relative rounded-xl overflow-hidden border border-white/10 bg-black/30 aspect-square">
                      {img
                        ? <img src={aiCharacterService.imageUrl(characterKey, img.id)} alt={SLOT_LABEL[slot]}
                            className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-gray-700"><ImageIcon className="w-6 h-6" /></div>}
                      <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
                        <span className="text-[10px] text-gray-300">{SLOT_LABEL[slot] || `图${slot}`}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 右：属性 / 辨识特征 / 着装描述 + 应用到画布 */}
            <div className="w-80 flex-shrink-0 border-l border-white/5 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div>
                  <div className="text-sm font-semibold text-gray-200 mb-3">角色属性</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    {detail.attribute_keys.map(k => {
                      const v = detail.attributes[k]
                      if (!v) return null
                      return (
                        <div key={k} className="flex flex-col">
                          <span className="text-[11px] text-gray-600">{k}</span>
                          <span className="text-xs text-gray-200">{v}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {detail.feature_desc && (
                  <div>
                    <div className="text-sm font-semibold text-gray-200 mb-1.5">辨识特征</div>
                    <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">{detail.feature_desc}</p>
                  </div>
                )}
                {detail.costume_desc && (
                  <div>
                    <div className="text-sm font-semibold text-gray-200 mb-1.5">着装描述</div>
                    <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">{detail.costume_desc}</p>
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 p-4 border-t border-white/5">
                {err && <p className="text-[11px] text-red-400 mb-2">{err}</p>}
                <button onClick={apply} disabled={applying}
                  className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                  {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  应用到画布
                </button>
                <p className="text-[10px] text-gray-600 mt-2 text-center leading-relaxed">
                  将复制为当前项目的角色要素，可自由改名 / 改属性
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
