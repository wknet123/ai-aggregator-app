/**
 * WorkPickerModal —— 从「我的作品」里选一张已生成图片作为 Run 输入素材。
 *
 * 拉 googleService.getHistory('image')，选中后调 agentService.uploadFromWork(task_id)
 * 由后端把作品复制为私有 image_key，回调 onPick(key)。
 */
import { useEffect, useState } from 'react'
import { X, Loader2, Check, ImageIcon } from 'lucide-react'
import { googleService } from '../../services/google.service'
import { agentService } from '../../services/agent.service'

interface Props {
  onPick: (key: string) => void
  onClose: () => void
}

export default function WorkPickerModal({ onPick, onClose }: Props) {
  const [works, setWorks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState('')     // 正在复制的 task_id

  useEffect(() => {
    let alive = true
    setLoading(true)
    googleService.getHistory('image', 60)
      .then((items) => { if (alive) setWorks(items || []) })
      .catch((e: any) => { if (alive) setError(e?.response?.data?.detail || e?.message || '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const pick = async (task: any) => {
    setPicking(task.task_id); setError('')
    try {
      const { key } = await agentService.uploadFromWork(task.task_id)
      onPick(key)
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '选取失败')
    } finally {
      setPicking('')
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-[#16161a] rounded-2xl border border-gray-800/60">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800/60">
          <ImageIcon className="w-4 h-4 text-pink-400" />
          <h3 className="text-sm font-bold text-gray-100">从我的作品选择</h3>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {error && <div className="mx-5 mt-3 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : works.length === 0 ? (
            <p className="text-center text-sm text-gray-600 mt-8">还没有图片作品可选</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {works.map((w) => {
                const url = googleService.getResultUrl(w.result_url)
                const busy = picking === w.task_id
                return (
                  <button key={w.task_id} onClick={() => pick(w)} disabled={!!picking}
                    className="group relative aspect-square rounded-lg border border-gray-800/60 bg-black/40 overflow-hidden hover:border-pink-500/60 disabled:opacity-50">
                    {url && <img src={url} alt="" className="w-full h-full object-cover" />}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                      {busy
                        ? <Loader2 className="w-5 h-5 text-white animate-spin" />
                        : <Check className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" />}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
