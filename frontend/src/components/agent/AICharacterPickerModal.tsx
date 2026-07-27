/**
 * AICharacterPickerModal —— 从共享 AI 角色库（全局只读）选一个角色，把其形象/着装描述注入目标。
 *
 * 复用 aiCharacterService（全局库，不依赖 project_id）。选中后回调 onPick 一段可读的角色描述文本，
 * 由调用方拼进 goal / persona。（参考图注入待后端补 image_key 通道，本期仅描述注入。）
 */
import { useEffect, useState } from 'react'
import { X, Loader2, Check, Users, Search } from 'lucide-react'
import { aiCharacterService, type AICharacterCard } from '../../services/ai-character.service'

interface Props {
  onPick: (desc: string, name: string) => void
  onClose: () => void
}

export default function AICharacterPickerModal({ onPick, onClose }: Props) {
  const [items, setItems] = useState<AICharacterCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState('')

  const load = async (query = '') => {
    setLoading(true); setError('')
    try {
      const res = await aiCharacterService.listCharacters({ q: query || undefined, limit: 60 })
      setItems(res.items || [])
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // 选中：取详情，拼成「角色名：形象特征；着装：…」注入文本。
  const pick = async (c: AICharacterCard) => {
    setPicking(c.character_key); setError('')
    try {
      const d = await aiCharacterService.getCharacter(c.character_key)
      const parts: string[] = []
      if (d.feature_desc) parts.push(`形象特征：${d.feature_desc}`)
      if (d.costume_desc) parts.push(`着装：${d.costume_desc}`)
      const attrs = Object.entries(d.attributes || {}).slice(0, 6)
        .map(([k, v]) => `${k}${v}`).join('、')
      if (!parts.length && attrs) parts.push(attrs)
      const desc = `角色「${d.name}」（${parts.join('；') || '见角色库'}）`
      onPick(desc, d.name)
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '选取失败')
    } finally {
      setPicking('')
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#16161a] rounded-2xl border border-gray-800/60">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800/60">
          <Users className="w-4 h-4 text-pink-400" />
          <h3 className="text-sm font-bold text-gray-100">选择 AI 角色</h3>
          <span className="text-[11px] text-gray-500">共享角色库</span>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-800/60">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input className="input pl-8 text-sm" placeholder="搜索角色名 / 属性…"
                value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') load(q) }} />
            </div>
            <button onClick={() => load(q)} className="px-3 py-2 rounded-lg text-xs bg-white/5 hover:bg-white/10 text-gray-300">搜索</button>
          </div>
        </div>

        {error && <div className="mx-5 mt-3 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : items.length === 0 ? (
            <p className="text-center text-sm text-gray-600 mt-8">没有找到角色</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {items.map((c) => {
                const busy = picking === c.character_key
                const cover = c.cover_image_id != null
                  ? aiCharacterService.imageUrl(c.character_key, c.cover_image_id) : ''
                return (
                  <button key={c.character_key} onClick={() => pick(c)} disabled={!!picking}
                    className="group rounded-lg border border-gray-800/60 bg-black/30 overflow-hidden hover:border-pink-500/60 disabled:opacity-50 text-left">
                    <div className="relative aspect-[3/4] bg-black/40 flex items-center justify-center">
                      {cover
                        ? <img src={cover} alt={c.name} className="w-full h-full object-cover" />
                        : <Users className="w-6 h-6 text-gray-600" />}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                        {busy
                          ? <Loader2 className="w-5 h-5 text-white animate-spin" />
                          : <Check className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" />}
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-300 px-1.5 py-1 truncate">{c.name}</p>
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
