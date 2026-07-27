/**
 * ResultRail —— 工作台右侧常驻「成果栏」：进入即第一眼可见最近产物缩略图墙。
 *
 * 点缩略图放大预览；每件可「复用目标再来一版」回填画布继续编辑；顶部「全部/对比」进完整画廊。
 * 数据复用 expandGalleryItems + ArtifactMedia（鉴权 blob 取流）。
 */
import { useMemo, useState } from 'react'
import { Images, RotateCcw, Maximize2, X } from 'lucide-react'
import type { AgentRun } from '../../services/agent.service'
import { ArtifactMedia, expandGalleryItems, type GalleryItem } from './ResultGallery'

interface Props {
  runs: AgentRun[]
  onOpenGallery: () => void
  onReuseGoal?: (goal: string, agentKey: string) => void
  locked?: boolean
}

export default function ResultRail({ runs, onOpenGallery, onReuseGoal, locked }: Props) {
  const items = useMemo<GalleryItem[]>(() => expandGalleryItems(runs), [runs])
  const [preview, setPreview] = useState<GalleryItem | null>(null)

  return (
    <aside className="hidden lg:flex flex-col w-72 shrink-0 border-l border-gray-800/60 bg-[#0d0d0f] overflow-hidden">
      <div className="px-3 py-3 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <Images className="w-4 h-4 text-pink-400" />
          <span className="text-sm font-semibold text-gray-200">我的成果</span>
          <button onClick={onOpenGallery}
            className="ml-auto text-[11px] text-gray-400 hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-white/10">
            全部 / 对比
          </button>
        </div>
        {items.length > 0 && (
          <p className="mt-1.5 text-[11px] text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400 font-medium">
            🎉 已产出 {items.length} 件成果，继续加油
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="text-[11px] text-gray-600 text-center mt-8 px-2">
            还没有成果。<br />跑一个 Run，产出会实时出现在这里。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {items.map((it, i) => (
              <div key={it.uid}
                className={`group relative rounded-lg border bg-[#16161a] overflow-hidden transition-all ${
                  i === 0
                    ? 'border-pink-500/70 ring-1 ring-pink-500/30 shadow-lg shadow-pink-500/10 animate-[pulse_1.5s_ease-in-out_2]'
                    : 'border-gray-800/60'}`}>
                {i === 0 && (
                  <span className="absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow">
                    NEW
                  </span>
                )}
                <div className="aspect-square bg-black/40 flex items-center justify-center">
                  <ArtifactMedia runId={it.runId} artifact={it.artifact} />
                </div>
                {/* 悬浮操作 */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
                  <button onClick={() => setPreview(it)} title="放大预览"
                    className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80">
                    <Maximize2 className="w-3.5 h-3.5 text-gray-200" />
                  </button>
                  {onReuseGoal && (
                    <button onClick={() => onReuseGoal(it.goal, it.agentKey)} disabled={locked}
                      title={locked ? '执行中，暂不可复用' : '复用目标再来一版'}
                      className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80 disabled:opacity-40">
                      <RotateCcw className="w-3.5 h-3.5 text-gray-200" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 放大预览 */}
      {preview && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/85 p-6"
          onClick={() => setPreview(null)}>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-300 line-clamp-1 flex-1 mr-3">{preview.goal}</p>
              <button onClick={() => setPreview(null)} className="p-1.5 rounded-lg hover:bg-white/10">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="rounded-xl border border-gray-800/60 bg-[#16161a] overflow-hidden flex items-center justify-center max-h-[75vh]">
              <ArtifactMedia runId={preview.runId} artifact={preview.artifact}
                className="max-w-full max-h-[75vh] object-contain" />
            </div>
            <div className="flex items-center gap-2 mt-3 text-[11px] text-gray-500">
              <span>{preview.agentKey}</span>
              <span className="ml-auto">花费 {preview.cost}</span>
              {onReuseGoal && (
                <button onClick={() => { onReuseGoal(preview.goal, preview.agentKey); setPreview(null) }}
                  disabled={locked}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10 disabled:opacity-40">
                  <RotateCcw className="w-3.5 h-3.5" />复用目标再来一版
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
