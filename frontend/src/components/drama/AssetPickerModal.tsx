/**
 * AssetPickerModal – 从「配置」库（角色 / 场景 / 道具）选取一个元素作为分镜/整集参考图。
 *
 * 复用 projectAssetService（配置页签同源数据）。选中一个元素后展开其图片缩略图，
 * 默认高亮主图、可点选任一张（主图/副图）。确认后回调选用信息：
 *   key   = 选中图片的 MinIO object key（image_path，可直接进生成链路）
 *   label = 元素名称（代入提示词「图片N为「名称」」）
 *   desc  = 元素描述（代入提示词「全片保持图片N「名称」的形象特征：…」）
 *   name / assetId / assetType = 溯源与展示
 */
import { useState, useEffect, useCallback } from 'react'
import { Users, MapPin, Package, X, Loader2, ImageIcon, Check, Star, Images } from 'lucide-react'
import {
  projectAssetService, ProjectAssetRecord, AssetType,
} from '../../services/project-asset.service'

const TYPE_TABS: { key: AssetType; label: string; icon: typeof Users }[] = [
  { key: 'character', label: '角色', icon: Users },
  { key: 'scene', label: '场景', icon: MapPin },
  { key: 'prop', label: '道具', icon: Package },
]

export interface AssetPickResult {
  key: string
  label: string
  desc: string
  name: string
  assetId: string
  assetType: AssetType
}

export default function AssetPickerModal({
  projectId, onClose, onPick,
}: {
  projectId: string
  onClose: () => void
  onPick: (sel: AssetPickResult) => void
}) {
  const [type, setType] = useState<AssetType>('character')
  const [assets, setAssets] = useState<ProjectAssetRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null)

  const typeLabel = TYPE_TABS.find(t => t.key === type)!.label

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const items = await projectAssetService.listAssets({ project_id: projectId, asset_type: type })
      setAssets(items)
      setSelectedAssetId(items[0]?.asset_id ?? null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, type])

  useEffect(() => { load() }, [load])

  const selected = assets.find(a => a.asset_id === selectedAssetId) || null

  // 选中元素变化：默认选其主图
  useEffect(() => {
    if (!selected) { setSelectedImageId(null); return }
    const cover = selected.images.find(i => i.is_cover === 1) || selected.images[0]
    setSelectedImageId(cover?.id ?? null)
  }, [selectedAssetId, selected])

  const activeImg = selected?.images.find(i => i.id === selectedImageId)
    || selected?.images.find(i => i.is_cover === 1) || selected?.images[0] || null

  const confirm = () => {
    if (!selected || !activeImg) return
    onPick({
      key: activeImg.image_path,
      label: selected.name,
      desc: selected.description || '',
      name: selected.name,
      assetId: selected.asset_id,
      assetType: selected.asset_type,
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#14141c] rounded-2xl border border-indigo-500/20 w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Images className="w-4 h-4 text-indigo-400" />从配置选取（角色 / 场景 / 道具）
          </h3>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 类型子页签 */}
        <div className="flex-shrink-0 flex items-center gap-1 px-5 pt-3">
          {TYPE_TABS.map(t => {
            const active = t.key === type
            return (
              <button key={t.key} onClick={() => setType(t.key)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/25'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04] border border-transparent'}`}>
                <t.icon className="w-3.5 h-3.5" />{t.label}
                {active && <span className="text-[10px] text-gray-500">{assets.length}</span>}
              </button>
            )
          })}
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0 mt-2">
          {/* 左：元素列表 */}
          <div className="w-[46%] max-w-[420px] border-r border-white/5 overflow-y-auto p-4 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-600 text-xs gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />加载中…
              </div>
            ) : error ? (
              <p className="text-[11px] text-red-400 bg-red-500/10 rounded-lg px-3 py-1.5">{error}</p>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ImageIcon className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-xs text-gray-500 mb-1">配置里还没有{typeLabel}</p>
                <p className="text-[11px] text-gray-700">先到「配置」页签新增{typeLabel}并填写描述。</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {assets.map(a => {
                  const cover = a.images.find(i => i.is_cover === 1) || a.images[0]
                  const active = a.asset_id === selectedAssetId
                  return (
                    <div key={a.asset_id} onClick={() => setSelectedAssetId(a.asset_id)}
                      className={`rounded-xl overflow-hidden border cursor-pointer transition-colors ${
                        active ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-white/8 hover:border-white/20 bg-white/[0.02]'}`}>
                      <div className="aspect-[4/3] bg-black/30 overflow-hidden">
                        {cover
                          ? <img src={projectAssetService.imageUrl(a.asset_id, cover.id)} alt={a.name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-gray-700" /></div>}
                      </div>
                      <div className="p-2">
                        <div className="text-[11px] font-medium text-gray-200 truncate">{a.name}</div>
                        <div className="text-[10px] text-gray-500 line-clamp-2 min-h-[26px]">{a.description || '（无描述）'}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 右：选中元素详情 + 选图 */}
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
            {selected ? (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-100">{selected.name}</div>
                  {selected.description
                    ? <div className="text-[11px] text-gray-400 mt-1 leading-relaxed">{selected.description}</div>
                    : <div className="text-[11px] text-amber-400/70 mt-1">该{typeLabel}未填描述，将只代入名称、不注入形象特征。</div>}
                </div>
                {/* 大图（当前选中图） */}
                <div className="rounded-xl overflow-hidden border border-white/10 bg-black/20 flex items-center justify-center max-h-64 p-2">
                  {activeImg
                    ? <img src={projectAssetService.imageUrl(selected.asset_id, activeImg.id)} alt={selected.name} className="max-w-full max-h-60 object-contain rounded-lg" />
                    : <div className="flex flex-col items-center text-gray-700 py-8"><ImageIcon className="w-8 h-8 mb-1" /><span className="text-xs">该{typeLabel}暂无图片</span></div>}
                </div>
                {/* 图片缩略图选择 */}
                {selected.images.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 mb-1.5">选用哪张图作为参考图（默认主图，可切换）</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {selected.images.map(img => {
                        const active = img.id === activeImg?.id
                        return (
                          <button key={img.id} onClick={() => setSelectedImageId(img.id)}
                            className={`group relative w-16 h-16 rounded-lg overflow-hidden border ${
                              active ? 'border-indigo-400 ring-2 ring-indigo-400/40' : 'border-white/10 hover:border-white/25'}`}>
                            <img src={projectAssetService.imageUrl(selected.asset_id, img.id)} alt="" className="w-full h-full object-cover" />
                            {img.is_cover === 1 && (
                              <div className="absolute top-0.5 left-0.5 w-4 h-4 flex items-center justify-center rounded bg-black/60" title="主图">
                                <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                              </div>
                            )}
                            {active && (
                              <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                                <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-600 text-xs">从左侧选择一个{typeLabel}</div>
            )}
          </div>
        </div>

        {/* 底部操作条 */}
        <div className="flex-shrink-0 px-5 pb-5 pt-3 flex items-center gap-3 border-t border-white/5">
          <span className="text-[11px] text-gray-500 flex-1">
            {selected && activeImg ? `将选用「${selected.name}」的这张图作为参考图` : '请选择一个带图片的元素'}
          </span>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm border border-white/10 text-gray-400 hover:bg-white/[0.04]">
            取消
          </button>
          <button onClick={confirm} disabled={!selected || !activeImg}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-40">
            <Check className="w-4 h-4" />确认选用
          </button>
        </div>
      </div>
    </div>
  )
}
