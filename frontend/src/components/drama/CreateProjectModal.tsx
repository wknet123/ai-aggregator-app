import React from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { dramaService, DramaProjectRecord } from '../../services/drama.service'

export default function CreateProjectModal({
  onCreated,
  onClose,
}: {
  onCreated: (project: DramaProjectRecord) => void
  onClose: () => void
}) {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleCreate = async () => {
    if (!name.trim()) { setError('请输入项目名称'); return }
    setLoading(true); setError('')
    try {
      const project = await dramaService.createProject({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      onCreated(project)
    } catch (e: any) {
      setError(e?.response?.data?.detail || '创建失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#14141c] rounded-2xl border border-purple-500/20 w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Plus className="w-4 h-4 text-purple-400" />
            新建短剧项目
          </h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">项目名称 *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="如：霸道总裁的秘密"
              autoFocus
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">项目描述（可选）</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="简要描述故事方向…"
              rows={3}
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40 resize-none"
            />
          </div>
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border border-white/10 text-gray-400 hover:bg-white/[0.04] transition-colors">
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            创建项目
          </button>
        </div>
      </div>
    </div>
  )
}
