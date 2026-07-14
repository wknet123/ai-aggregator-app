/**
 * 素材预览灯箱：图片/视频/音频全屏查看原图，点击遮罩或关闭按钮退出。
 * 传入 editable + onSave 时，额外提供「标题 / 描述」就地编辑（保存回写到对应图片/素材）。
 * 由分镜拆分（分镜自有图片 / 整集全局图片）与整集素材库共用。
 */
import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { dramaService } from '../../services/drama.service'

export default function AssetPreviewModal({
  kind, objectKey, name, label, desc, editable = false, onSave, onClose,
}: {
  kind: 'image' | 'video' | 'audio'
  objectKey: string
  name?: string
  label?: string
  desc?: string
  editable?: boolean
  onSave?: (patch: { label: string; desc: string }) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [editLabel, setEditLabel] = useState(label || '')
  const [editDesc, setEditDesc] = useState(desc || '')

  useEffect(() => {
    let alive = true
    setUrl(''); setError('')
    dramaService.assetPreviewUrl(objectKey)
      .then(u => { if (alive) setUrl(u) })
      .catch(e => { if (alive) setError(e?.response?.data?.detail || e?.message || '预览地址获取失败') })
    return () => { alive = false }
  }, [objectKey])
  useEffect(() => { setEditLabel(label || ''); setEditDesc(desc || '') }, [label, desc, objectKey])

  const dirty = editable && (editLabel !== (label || '') || editDesc !== (desc || ''))
  const save = () => { onSave?.({ label: editLabel.trim(), desc: editDesc }); onClose() }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div onClick={e => e.stopPropagation()} className="relative max-w-3xl w-full max-h-[88vh] flex flex-col rounded-2xl border border-white/10 bg-[#0d0d15] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8">
          <span className="text-xs text-gray-300 truncate">{name || label || '素材预览'}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center justify-center p-4 bg-black/30 min-h-[240px]">
            {error ? <p className="text-[11px] text-red-400">{error}</p>
              : !url ? <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
              : kind === 'image' ? <img src={url} alt={name || ''} className="max-w-full max-h-[62vh] object-contain rounded-lg" />
              : kind === 'video' ? <video src={url} controls autoPlay className="max-w-full max-h-[62vh] rounded-lg bg-black" />
              : <audio src={url} controls autoPlay className="w-full" />}
          </div>
          {editable && (
            <div className="p-4 space-y-2.5 border-t border-white/8">
              <div>
                <label className="text-[10px] text-gray-500">标题 / 名称</label>
                <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                  placeholder="图片名称/视角（如：林晚的肖像特写）"
                  className="mt-1 w-full bg-[#06060e] border border-indigo-500/15 rounded-md px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">描述</label>
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3}
                  placeholder="形态/特征描述（选填）"
                  className="mt-1 w-full bg-[#06060e] border border-purple-500/15 rounded-md px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-400/40 resize-none" />
              </div>
            </div>
          )}
        </div>
        {editable && (
          <div className="flex-shrink-0 flex items-center justify-end gap-2 px-4 py-2.5 border-t border-white/8">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-400 hover:bg-white/[0.04]">取消</button>
            <button onClick={save} disabled={!dirty}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-40">保存</button>
          </div>
        )}
      </div>
    </div>
  )
}
