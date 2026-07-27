/**
 * ResultGallery —— 智能体成果画廊（数据源：我的作品 generation_tasks）。
 *
 * 与「我的作品」交互一致：收藏 / 删除 / 预览，复用 googleService。只展示来源为智能体的作品
 * （model_id 前缀 agent:）。支持多选 2~4 件并排对比。
 * 产物图/视频经公开取流端点 /api/v1/google/task/{id}/file 直接加载。
 *
 * 保留 expandGalleryItems / ArtifactMedia 导出：首屏成果墙（基于 agent_runs）仍复用。
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Star, RotateCcw, X, GitCompare, CheckSquare, Square, Trash2 } from 'lucide-react'
import { agentService, type AgentRun, type AgentArtifact } from '../../services/agent.service'
import { googleService } from '../../services/google.service'

// 一件成果作品（来自 generation_tasks）。
export interface WorkItem {
  task_id: string
  task_type: 'image' | 'video'
  prompt: string
  result_url: string
  model_id: string
  is_favorite: boolean
  created_at?: string | null
}

// 保留：首屏成果墙（基于 agent_runs.final_artifacts）用的展开结构与类型。
export interface GalleryItem {
  runId: string
  agentKey: string
  goal: string
  createdAt?: string | null
  cost: number
  idx: number
  artifact: AgentArtifact
  uid: string
}

// 按来源智能体（model_id）分组，保持各组内原有顺序、组按首次出现顺序。
function groupByAgent(items: WorkItem[]): [string, WorkItem[]][] {
  const m = new Map<string, WorkItem[]>()
  for (const it of items) {
    const arr = m.get(it.model_id) || []
    arr.push(it)
    m.set(it.model_id, arr)
  }
  return Array.from(m.entries())
}

// runs → 一维产物列表（completed 且有 media 产物）。首屏成果墙复用。
export function expandGalleryItems(runs: AgentRun[]): GalleryItem[] {
  const out: GalleryItem[] = []
  for (const r of runs) {
    if (r.status !== 'completed' || !r.final_artifacts?.length) continue
    r.final_artifacts.forEach((a, idx) => {
      if (a.type !== 'image' && a.type !== 'video') return
      out.push({
        runId: r.run_id, agentKey: r.agent_key, goal: r.goal,
        createdAt: r.created_at, cost: r.total_cost ?? 0,
        idx, artifact: a, uid: `${r.run_id}#${idx}`,
      })
    })
  }
  return out
}

interface Props {
  onReuseGoal?: (goal: string, agentKey: string) => void   // 复用目标（此处以作品 prompt 回填）
  agentNames?: Record<string, string>                       // agent_id → 显示名（分组标题用）
  onClose: () => void
}

export default function ResultGallery({ onReuseGoal, agentNames = {}, onClose }: Props) {
  const [items, setItems] = useState<WorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [onlyFav, setOnlyFav] = useState(false)
  const [busy, setBusy] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [imgs, vids] = await Promise.all([
        googleService.getHistory('image', 80),
        googleService.getHistory('video', 80),
      ])
      // 只保留来源为智能体的作品（model_id 前缀 agent:），按时间倒序。
      const all = [...(imgs || []), ...(vids || [])]
        .filter((w) => typeof w.model_id === 'string' && w.model_id.startsWith('agent:'))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      setItems(all as WorkItem[])
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const shown = onlyFav ? items.filter((it) => it.is_favorite) : items

  const toggleSelect = (id: string) => {
    setSelected((xs) => {
      if (xs.includes(id)) return xs.filter((x) => x !== id)
      if (xs.length >= 4) return xs
      return [...xs, id]
    })
  }

  const toggleFavorite = async (id: string) => {
    setBusy(id)
    try {
      const { is_favorite } = await googleService.toggleFavorite(id)
      setItems((xs) => xs.map((it) => it.task_id === id ? { ...it, is_favorite } : it))
    } catch (e: any) {
      setError(e?.response?.data?.detail || '收藏失败')
    } finally { setBusy('') }
  }

  const remove = async (id: string) => {
    if (!confirm('确定要删除这个成果吗？')) return
    setBusy(id)
    try {
      await googleService.deleteTask(id)
      setItems((xs) => xs.filter((it) => it.task_id !== id))
      setSelected((xs) => xs.filter((x) => x !== id))
    } catch (e: any) {
      setError(e?.response?.data?.detail || '删除失败')
    } finally { setBusy('') }
  }

  const compareItems = items.filter((it) => selected.includes(it.task_id))

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0d0d0f]">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-gray-800/60">
        <h2 className="text-base font-bold text-gray-100">成果画廊</h2>
        <span className="text-xs font-medium text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400">
          🎉 {shown.length} 件成果
        </span>
        <button onClick={() => setOnlyFav((v) => !v)}
          className={`text-xs px-2 py-1 rounded-lg border ${
            onlyFav ? 'border-amber-500/60 text-amber-300 bg-amber-500/10' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
          <Star className="w-3 h-3 inline mr-1" />只看收藏
        </button>
        <div className="ml-auto flex items-center gap-2">
          {selected.length >= 2 && (
            <button onClick={() => setComparing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-pink-500 to-purple-500 text-white">
              <GitCompare className="w-3.5 h-3.5" />对比 {selected.length} 个
            </button>
          )}
          {selected.length > 0 && (
            <button onClick={() => setSelected([])}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5">清空选择</button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {error && <div className="mx-4 md:mx-6 mt-3 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

      {/* 卡片墙 */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : shown.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-600">
            {onlyFav ? '还没有收藏的成果' : '暂无成果——跑一个智能体试试'}
          </div>
        ) : (
          <div className="space-y-6">
            {groupByAgent(shown).map(([modelId, groupItems]) => {
              const key = modelId.replace(/^agent:/, '')
              return (
                <div key={modelId}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-sm font-semibold text-gray-200">{agentNames[key] || key}</span>
                    <span className="text-[11px] text-gray-500">{groupItems.length} 件</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                    {groupItems.map((it) => (
                      <WorkCard key={it.task_id} item={it}
                        selected={selected.includes(it.task_id)}
                        busy={busy === it.task_id}
                        onToggleSelect={() => toggleSelect(it.task_id)}
                        onToggleFavorite={() => toggleFavorite(it.task_id)}
                        onRemove={() => remove(it.task_id)}
                        onReuseGoal={onReuseGoal ? () => onReuseGoal(it.prompt, '') : undefined} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 并排对比 */}
      {comparing && compareItems.length >= 2 && (
        <CompareView items={compareItems} onClose={() => setComparing(false)}
          onToggleFavorite={toggleFavorite} onReuseGoal={onReuseGoal} />
      )}
    </div>
  )
}

// ── 保留：鉴权 blob 取流的产物媒体（首屏成果墙基于 agent_runs 用）──────────────
export function ArtifactMedia({ runId, artifact, className }: {
  runId: string; artifact: AgentArtifact; className?: string
}) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const isMedia = artifact.type === 'image' || artifact.type === 'video'

  useEffect(() => {
    let alive = true, revoked = ''
    if (isMedia && artifact.key) {
      agentService.artifactObjectUrl(runId, artifact.key)
        .then((u) => { if (alive) { setUrl(u); revoked = u } else URL.revokeObjectURL(u) })
        .catch((e) => { if (alive) setErr(e?.message || '加载失败') })
    }
    return () => { alive = false; if (revoked) URL.revokeObjectURL(revoked) }
  }, [runId, artifact.key, isMedia])

  if (!isMedia) return <span className="text-xs text-gray-500 uppercase">{artifact.type}</span>
  if (err) return <span className="text-[11px] text-red-400 px-2 text-center">{err}</span>
  if (!url) return <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
  return artifact.type === 'image'
    ? <img src={url} alt="" className={className || 'max-w-full max-h-full object-contain'} />
    : <video src={url} controls className={className || 'max-w-full max-h-full'} />
}

// ── 作品媒体（公开取流 URL，可直接 <img>/<video>）────────────────────────────
function WorkMedia({ item, className }: { item: WorkItem; className?: string }) {
  const url = googleService.getResultUrl(item.result_url)
  if (!url) return <span className="text-[11px] text-gray-500">无文件</span>
  return item.task_type === 'video'
    ? <video src={url} controls className={className || 'max-w-full max-h-full'} />
    : <img src={url} alt="" className={className || 'max-w-full max-h-full object-contain'} />
}

// ── 成果卡（收藏 / 删除 / 多选 / 复用）────────────────────────────────────────
function WorkCard({ item, selected, busy, onToggleSelect, onToggleFavorite, onRemove, onReuseGoal }: {
  item: WorkItem; selected: boolean; busy: boolean
  onToggleSelect: () => void; onToggleFavorite: () => void; onRemove: () => void; onReuseGoal?: () => void
}) {
  return (
    <div className={`rounded-xl border overflow-hidden bg-[#16161a] transition-colors ${
      selected ? 'border-pink-500/70' : 'border-gray-800/60'}`}>
      <div className="relative aspect-square bg-black/40 flex items-center justify-center">
        <WorkMedia item={item} />
        <button onClick={onToggleSelect}
          className="absolute top-2 left-2 p-1 rounded-md bg-black/50 hover:bg-black/70">
          {selected ? <CheckSquare className="w-4 h-4 text-pink-400" /> : <Square className="w-4 h-4 text-gray-300" />}
        </button>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <button onClick={onToggleFavorite} disabled={busy} title={item.is_favorite ? '取消收藏' : '收藏'}
            className="p-1 rounded-md bg-black/50 hover:bg-black/70 disabled:opacity-50">
            <Star className={`w-4 h-4 ${item.is_favorite ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
          </button>
          <button onClick={onRemove} disabled={busy} title="删除"
            className="p-1 rounded-md bg-black/50 hover:bg-black/70 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 text-gray-300 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-400" />}
          </button>
        </div>
      </div>
      <div className="p-2.5">
        <p className="text-[11px] text-gray-300 line-clamp-2 mb-1">{item.prompt}</p>
        {onReuseGoal && (
          <button onClick={onReuseGoal}
            className="mt-1 w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] text-gray-300 bg-white/5 hover:bg-white/10">
            <RotateCcw className="w-3 h-3" />以此为目标再来一版
          </button>
        )}
      </div>
    </div>
  )
}

// ── 并排对比 ──────────────────────────────────────────────────────────────────
function CompareView({ items, onClose, onToggleFavorite, onReuseGoal }: {
  items: WorkItem[]; onClose: () => void
  onToggleFavorite: (id: string) => void
  onReuseGoal?: (goal: string, agentKey: string) => void
}) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/85 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-gray-800/60">
        <GitCompare className="w-4 h-4 text-pink-400" />
        <h3 className="text-sm font-bold text-gray-100">并排对比（{items.length}）</h3>
        <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-white/10">
          <X className="w-5 h-5 text-gray-400" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(220px, 1fr))` }}>
          {items.map((it) => (
            <div key={it.task_id} className="rounded-xl border border-gray-800/60 bg-[#16161a] overflow-hidden flex flex-col">
              <div className="aspect-square bg-black/40 flex items-center justify-center">
                <WorkMedia item={it} />
              </div>
              <div className="p-3 space-y-1.5 flex-1 flex flex-col">
                <p className="text-xs text-gray-200 line-clamp-3">{it.prompt}</p>
                <dl className="text-[11px] text-gray-500 space-y-0.5">
                  <div className="flex justify-between"><dt>类型</dt><dd className="text-gray-400">{it.task_type}</dd></div>
                  <div className="flex justify-between"><dt>来源</dt><dd className="text-gray-400 truncate ml-2">{it.model_id.replace('agent:', '')}</dd></div>
                </dl>
                <div className="mt-auto pt-2 flex items-center gap-1.5">
                  <button onClick={() => onToggleFavorite(it.task_id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-white/5 hover:bg-white/10">
                    <Star className={`w-3 h-3 ${it.is_favorite ? 'text-amber-400 fill-amber-400' : 'text-gray-400'}`} />
                    {it.is_favorite ? '已收藏' : '收藏'}
                  </button>
                  {onReuseGoal && (
                    <button onClick={() => onReuseGoal(it.prompt, '')}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-gray-300 bg-white/5 hover:bg-white/10">
                      <RotateCcw className="w-3 h-3" />复用
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
