/**
 * AssetConfigPanel – 项目「配置」页签：角色 / 场景 / 道具 素材管理。
 *
 * 布局（对标火山「剧创·设定」）：
 *   顶部：角色 / 场景 / 道具 三类子页签 + 统计 + 新增按钮
 *   左：检索列表——缩略图 + 名称 + 描述，两列上下滚动
 *   右：选中项详情——大图（当前选中图）+ 该项全部图片缩略图（hover 删除）
 *       底部操作条：文生图生成 / 本地上传，追加副图
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Users, MapPin, Package, Plus, Upload, Sparkles, Trash2, X, Loader2,
  ImageIcon, Star, Wand2, Images, Check,
} from 'lucide-react'
import {
  projectAssetService, ProjectAssetRecord, ProjectAssetImageRecord, AssetType,
} from '../../services/project-asset.service'
import { fluxService } from '../../services/flux.service'
import { googleService } from '../../services/google.service'
import { polishPrompt } from '../../services/prompt.service'
import AICharacterLibraryModal from './AICharacterLibraryModal'

const TYPE_TABS: { key: AssetType; label: string; icon: typeof Users }[] = [
  { key: 'character', label: '角色', icon: Users },
  { key: 'scene', label: '场景', icon: MapPin },
  { key: 'prop', label: '道具', icon: Package },
]

// 分镜图默认所用 wan 文生图模型（与项目图像生成保持一致）
const T2I_MODEL_ID = 'wan2.7-image'

function imgSrc(asset: ProjectAssetRecord, image: ProjectAssetImageRecord): string {
  return projectAssetService.imageUrl(asset.asset_id, image.id)
}

/** 把一个作品的图片 URL 拉取为 File，供 createAsset / addImages 复用上传通道。 */
async function workToFile(work: { task_id: string; result_url: string }): Promise<File> {
  const resp = await fetch(googleService.getResultUrl(work.result_url))
  if (!resp.ok) throw new Error('图片获取失败')
  const blob = await resp.blob()
  const type = blob.type || 'image/jpeg'
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
  return new File([blob], `work_${work.task_id}.${ext}`, { type })
}

export default function AssetConfigPanel({
  projectId, aspect, locked = false,
}: {
  projectId: string
  aspect: string
  locked?: boolean
}) {
  const [type, setType] = useState<AssetType>('character')
  const [assets, setAssets] = useState<ProjectAssetRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showAILibrary, setShowAILibrary] = useState(false)

  const typeLabel = TYPE_TABS.find(t => t.key === type)!.label

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const items = await projectAssetService.listAssets({ project_id: projectId, asset_type: type })
      setAssets(items)
      setSelectedId(prev => (prev && items.some(a => a.asset_id === prev)) ? prev : (items[0]?.asset_id ?? null))
    } catch (e: any) {
      setError(e?.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, type])

  useEffect(() => { load() }, [load])

  const selected = assets.find(a => a.asset_id === selectedId) || null

  const patchAsset = (updated: ProjectAssetRecord) => {
    setAssets(prev => prev.map(a => a.asset_id === updated.asset_id ? updated : a))
  }

  const handleCreated = (created: ProjectAssetRecord) => {
    setShowCreate(false)
    setAssets(prev => [...prev, created])
    setSelectedId(created.asset_id)
  }

  const handleDeleteAsset = async (asset: ProjectAssetRecord) => {
    if (!confirm(`确认删除「${asset.name}」？`)) return
    try {
      await projectAssetService.deleteAsset(asset.asset_id)
      setAssets(prev => {
        const next = prev.filter(a => a.asset_id !== asset.asset_id)
        if (selectedId === asset.asset_id) setSelectedId(next[0]?.asset_id ?? null)
        return next
      })
    } catch (e: any) {
      setError(e?.response?.data?.detail || '删除失败')
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* 类型子页签 */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 md:px-6 py-2 border-b border-white/5 bg-[#0d0d15]">
        {TYPE_TABS.map(t => {
          const active = t.key === type
          const count = active ? assets.length : undefined
          return (
            <button key={t.key} disabled={locked}
              onClick={() => { if (!locked) setType(t.key) }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
                active ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/25'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04] border border-transparent'}`}>
              <t.icon className="w-3.5 h-3.5" />{t.label}
              {count !== undefined && <span className="text-[10px] text-gray-500">{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* 左：检索列表 */}
        <div className="flex flex-col w-[46%] max-w-[520px] border-r border-white/5 min-h-0">
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5">
            <div className="text-xs text-gray-400">
              {typeLabel} <span className="text-gray-600">共 {assets.length}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {type === 'character' && (
                <button disabled={locked}
                  onClick={() => setShowAILibrary(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-40 border border-purple-500/20">
                  <Sparkles className="w-3.5 h-3.5" />AI角色库
                </button>
              )}
              <button disabled={locked}
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-40 border border-indigo-500/20">
                <Plus className="w-3.5 h-3.5" />新增{typeLabel}
              </button>
            </div>
          </div>
          {error && <p className="mx-4 mb-2 text-[11px] text-red-400 bg-red-500/10 rounded-lg px-3 py-1.5">{error}</p>}
          <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-600 text-xs gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />加载中…
              </div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ImageIcon className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-xs text-gray-500 mb-1">还没有{typeLabel}</p>
                <p className="text-[11px] text-gray-700">点「新增{typeLabel}」添加，主图必备，可补充其他视角副图。</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {assets.map(a => {
                  const cover = a.images.find(i => i.is_cover === 1) || a.images[0]
                  const active = a.asset_id === selectedId
                  return (
                    <div key={a.asset_id}
                      onClick={() => setSelectedId(a.asset_id)}
                      className={`group relative rounded-xl overflow-hidden border cursor-pointer transition-colors ${
                        active ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-white/8 hover:border-white/20 bg-white/[0.02]'}`}>
                      <div className="aspect-[4/3] bg-black/30 overflow-hidden">
                        {cover
                          ? <img src={imgSrc(a, cover)} alt={a.name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-5 h-5 text-gray-700" /></div>}
                      </div>
                      <div className="p-2">
                        <div className="text-[11px] font-medium text-gray-200 truncate">{a.name}</div>
                        <div className="text-[10px] text-gray-500 line-clamp-2 min-h-[26px]">{a.description || '—'}</div>
                      </div>
                      <button
                        onClick={ev => { ev.stopPropagation(); handleDeleteAsset(a) }}
                        title="删除"
                        className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-lg bg-black/60 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右：选中项详情 */}
        <div className="flex-1 min-w-0 min-h-0">
          {selected
            ? <AssetDetail asset={selected} projectId={projectId} aspect={aspect} locked={locked}
                onChange={patchAsset} />
            : <div className="h-full flex items-center justify-center text-gray-600 text-xs">
                从左侧选择一个{typeLabel}查看详情
              </div>}
        </div>
      </div>

      {showCreate && (
        <AssetCreateModal projectId={projectId} assetType={type} typeLabel={typeLabel} aspect={aspect}
          onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}

      {showAILibrary && (
        <AICharacterLibraryModal projectId={projectId}
          onClose={() => setShowAILibrary(false)}
          onApplied={() => { setShowAILibrary(false); load() }} />
      )}
    </div>
  )
}

/* ── 右侧详情：大图 + 全部缩略图 + 追加副图操作条 ── */
function AssetDetail({
  asset, projectId, aspect, locked, onChange,
}: {
  asset: ProjectAssetRecord
  projectId: string
  aspect: string
  locked: boolean
  onChange: (a: ProjectAssetRecord) => void
}) {
  const [activeImgId, setActiveImgId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showT2I, setShowT2I] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // 名称 / 描述 就地编辑 + 一键润色
  const [editName, setEditName] = useState(asset.name)
  const [editDesc, setEditDesc] = useState(asset.description || '')
  const [savingMeta, setSavingMeta] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [metaErr, setMetaErr] = useState('')
  const lastAssetIdRef = useRef(asset.asset_id)

  // 切换选中元素时同步表单（同一元素被外部更新则保留正在编辑的内容）
  useEffect(() => {
    if (lastAssetIdRef.current !== asset.asset_id) {
      lastAssetIdRef.current = asset.asset_id
      setEditName(asset.name)
      setEditDesc(asset.description || '')
      setMetaErr('')
    }
  }, [asset.asset_id, asset.name, asset.description])

  const metaDirty = editName.trim() !== asset.name || editDesc !== (asset.description || '')

  const handlePolishDesc = async () => {
    if (!editDesc.trim() || polishing || savingMeta) return
    setPolishing(true); setMetaErr('')
    try {
      const polished = await polishPrompt(editDesc.trim(), 'image')
      if (polished) setEditDesc(polished)
    } catch (e: any) {
      setMetaErr(e?.response?.data?.detail || '润色失败，请稍后重试')
    } finally {
      setPolishing(false)
    }
  }

  const handleSaveMeta = async () => {
    if (!editName.trim()) { setMetaErr('名称不能为空'); return }
    setSavingMeta(true); setMetaErr('')
    try {
      const updated = await projectAssetService.updateAsset(asset.asset_id, {
        name: editName.trim(), description: editDesc,
      })
      onChange(updated)
    } catch (e: any) {
      setMetaErr(e?.response?.data?.detail || '保存失败')
    } finally {
      setSavingMeta(false)
    }
  }

  // 选中项/图片列表变化时，保证 activeImgId 有效（默认主图）
  useEffect(() => {
    const cover = asset.images.find(i => i.is_cover === 1) || asset.images[0]
    setActiveImgId(prev => (prev && asset.images.some(i => i.id === prev)) ? prev : (cover?.id ?? null))
  }, [asset])

  const activeImg = asset.images.find(i => i.id === activeImgId) || asset.images[0] || null

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true); setError('')
    try {
      const updated = await projectAssetService.addImages(asset.asset_id, { files: Array.from(files) })
      onChange(updated)
    } catch (e: any) {
      setError(e?.response?.data?.detail || '上传失败')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDeleteImage = async (imageId: number) => {
    setError('')
    try {
      const updated = await projectAssetService.deleteImage(asset.asset_id, imageId)
      onChange(updated)
    } catch (e: any) {
      setError(e?.response?.data?.detail || '删除失败')
    }
  }

  const handleT2IDone = (updated: ProjectAssetRecord) => {
    setShowT2I(false)
    onChange(updated)
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 标题：名称 / 描述 就地编辑 + 一键润色 + 保存 */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-white/5 space-y-2">
        <input value={editName} disabled={locked || savingMeta}
          onChange={e => setEditName(e.target.value)} placeholder="名称"
          className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 disabled:opacity-60" />
        <textarea value={editDesc} disabled={locked || savingMeta} rows={2}
          onChange={e => setEditDesc(e.target.value)}
          placeholder="描述外观 / 特征 / 用途，用于代入剧创提示词保证形态一致"
          className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-1.5 text-[11px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40 resize-none disabled:opacity-60" />
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handlePolishDesc} disabled={locked || polishing || savingMeta || !editDesc.trim()}
            title="AI 一键润色描述"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-indigo-300 border border-indigo-500/20 bg-indigo-500/10 hover:bg-indigo-500/20 disabled:opacity-40">
            {polishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}一键润色
          </button>
          <button onClick={handleSaveMeta} disabled={locked || savingMeta || !metaDirty || !editName.trim()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90 disabled:opacity-40">
            {savingMeta ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}保存
          </button>
          {metaDirty && !metaErr && <span className="text-[10px] text-amber-400/70">有未保存修改</span>}
          {metaErr && <span className="text-[10px] text-red-400">{metaErr}</span>}
        </div>
      </div>

      {/* 大图 */}
      <div className="flex-1 min-h-0 overflow-hidden bg-black/20 flex items-center justify-center p-4">
        {activeImg
          ? <img src={imgSrc(asset, activeImg)} alt={asset.name} className="max-w-full max-h-full object-contain rounded-lg" />
          : <div className="flex flex-col items-center text-gray-700"><ImageIcon className="w-10 h-10 mb-2" /><span className="text-xs">暂无图片</span></div>}
      </div>

      {error && <p className="mx-5 mt-2 text-[11px] text-red-400 bg-red-500/10 rounded-lg px-3 py-1.5">{error}</p>}

      {/* 缩略图检索 + 操作条 */}
      <div className="flex-shrink-0 border-t border-white/5 p-4 space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {asset.images.map(img => {
            const active = img.id === activeImg?.id
            return (
              <div key={img.id}
                onClick={() => setActiveImgId(img.id)}
                className={`group relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border cursor-pointer ${
                  active ? 'border-indigo-400' : 'border-white/10 hover:border-white/25'}`}>
                <img src={imgSrc(asset, img)} alt="" className="w-full h-full object-cover" />
                {img.is_cover === 1 && (
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 flex items-center justify-center rounded bg-black/60" title="主图">
                    <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                  </div>
                )}
                {asset.images.length > 1 && (
                  <button
                    onClick={ev => { ev.stopPropagation(); handleDeleteImage(img.id) }}
                    title={img.is_cover === 1 ? '删除主图（将自动改选下一张）' : '删除'}
                    className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded bg-black/70 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <button disabled={locked || busy}
            onClick={() => setShowT2I(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-40 border border-purple-500/20">
            <Sparkles className="w-3.5 h-3.5" />文生图生成
          </button>
          <button disabled={locked || busy}
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] disabled:opacity-40 border border-white/10">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}本地上传
          </button>
          <button disabled={locked || busy}
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] disabled:opacity-40 border border-white/10">
            <Images className="w-3.5 h-3.5" />从作品选择
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
            onChange={e => handleUpload(e.target.files)} />
          <span className="text-[10px] text-gray-600">追加其他视角副图</span>
        </div>
      </div>

      {showT2I && (
        <TextToImageModal aspect={aspect} projectId={projectId}
          onClose={() => setShowT2I(false)}
          onGenerated={async (taskId) => {
            const updated = await projectAssetService.addImages(asset.asset_id, { fluxTaskId: taskId })
            handleT2IDone(updated)
          }} />
      )}

      {showPicker && (
        <ImagePickerModal onClose={() => setShowPicker(false)}
          onPick={async (files) => {
            const updated = await projectAssetService.addImages(asset.asset_id, { files })
            setShowPicker(false)
            onChange(updated)
          }} />
      )}
    </div>
  )
}

/* ── 文生图弹窗：输入 prompt → flux 生成 → 回调 taskId ── */
function TextToImageModal({
  aspect, projectId, onClose, onGenerated,
}: {
  aspect: string
  projectId: string
  onClose: () => void
  onGenerated: (taskId: string) => Promise<void>
}) {
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'attaching'>('idle')
  const [progress, setProgress] = useState(0)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [polishing, setPolishing] = useState(false)

  const busy = status !== 'idle'

  const handlePolish = async () => {
    if (!prompt.trim() || polishing || busy) return
    setPolishing(true); setError('')
    try {
      const polished = await polishPrompt(prompt.trim(), 'image')
      if (polished) setPrompt(polished)
    } catch (e: any) {
      setError(e?.response?.data?.detail || '润色失败，请稍后重试')
    } finally {
      setPolishing(false)
    }
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) { setError('请输入描述'); return }
    setStatus('generating'); setError(''); setProgress(0); setPreviewUrl('')
    try {
      const task = await fluxService.generateImage({
        prompt: prompt.trim(),
        model_id: T2I_MODEL_ID,
        aspect_ratio: aspect,
        drama_project_id: projectId,
      })
      const final = await fluxService.pollTaskStatus(task.task_id, (p) => setProgress(p))
      if (final.status !== 'completed') throw new Error(final.error || '生成失败')
      setPreviewUrl(`/api/v1/flux/task/${final.task_id}/file`)
      setStatus('attaching')
      await onGenerated(final.task_id)
      // onGenerated 成功后父组件会关闭弹窗
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '生成失败')
      setStatus('idle')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#14141c] rounded-2xl border border-purple-500/20 w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />文生图生成
          </h3>
          <button onClick={onClose} disabled={busy}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-500">图片描述 *</label>
              <button onClick={handlePolish} disabled={busy || polishing || !prompt.trim()}
                title="AI 一键润色提示词"
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-40 border border-indigo-500/20">
                {polishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}一键润色
              </button>
            </div>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              disabled={busy} rows={4} autoFocus
              placeholder="描述你想生成的画面，如：银发青年，灰色麻衣，仙侠风，全身正面立绘…"
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40 resize-none disabled:opacity-60" />
            <p className="text-[10px] text-gray-600 mt-1">比例 {aspect}，使用平台文生图模型。</p>
          </div>
          {previewUrl && (
            <div className="rounded-xl overflow-hidden border border-white/10 bg-black/30 flex items-center justify-center max-h-56">
              <img src={previewUrl} alt="预览" className="max-w-full max-h-56 object-contain" />
            </div>
          )}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-purple-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status === 'generating' ? `生成中… ${progress}%` : '正在添加到素材…'}
            </div>
          )}
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose} disabled={busy}
            className="flex-1 py-2.5 rounded-xl text-sm border border-white/10 text-gray-400 hover:bg-white/[0.04] disabled:opacity-40">
            取消
          </button>
          <button onClick={handleGenerate} disabled={busy || !prompt.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:opacity-90 disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}生成并添加
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── 作品选择弹窗：我的作品 / 公共发现，多选后回调 File[] ── */
function ImagePickerModal({
  onClose, onPick,
}: {
  onClose: () => void
  onPick: (files: File[]) => Promise<void>
}) {
  type Source = 'mine' | 'public'
  type Work = { task_id: string; result_url: string; prompt?: string }

  const [source, setSource] = useState<Source>('mine')
  const [works, setWorks] = useState<Work[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError(''); setSelected(new Set())
    const loader = source === 'mine'
      ? googleService.getHistory('image', 50)
      : googleService.getPublicWorks('image', 50)
    loader
      .then(items => { if (alive) setWorks((items || []).filter((w: Work) => w.result_url)) })
      .catch((e: any) => { if (alive) setError(e?.response?.data?.detail || '加载失败') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [source])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleImport = async () => {
    const picked = works.filter(w => selected.has(w.task_id))
    if (picked.length === 0) return
    setImporting(true); setError('')
    try {
      const files = await Promise.all(picked.map(workToFile))
      await onPick(files)
      // 父组件成功后关闭
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '导入失败')
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#14141c] rounded-2xl border border-purple-500/20 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Images className="w-4 h-4 text-purple-400" />从作品选择
          </h3>
          <button onClick={onClose} disabled={importing}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* 来源切换 */}
        <div className="flex-shrink-0 flex items-center gap-1 px-5 pt-3">
          {([{ key: 'mine', label: '我的作品' }, { key: 'public', label: '公共发现' }] as const).map(s => (
            <button key={s.key} disabled={importing}
              onClick={() => setSource(s.key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
                source === s.key ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/25'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04] border border-transparent'}`}>
              {s.label}
            </button>
          ))}
        </div>
        {/* 网格 */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-600 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />加载中…
            </div>
          ) : works.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ImageIcon className="w-8 h-8 text-gray-700 mb-2" />
              <p className="text-xs text-gray-500">{source === 'mine' ? '还没有生成的图片作品' : '暂无公共图片作品'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2.5">
              {works.map(w => {
                const active = selected.has(w.task_id)
                return (
                  <div key={w.task_id} onClick={() => toggle(w.task_id)}
                    title={w.prompt || ''}
                    className={`group relative aspect-square rounded-lg overflow-hidden border cursor-pointer ${
                      active ? 'border-indigo-400 ring-2 ring-indigo-400/40' : 'border-white/10 hover:border-white/25'}`}>
                    <img src={googleService.getResultUrl(w.result_url)} alt="" className="w-full h-full object-cover" />
                    {active && (
                      <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex-shrink-0 px-5 pb-5 pt-2 flex items-center gap-3 border-t border-white/5">
          <span className="text-[11px] text-gray-500 flex-1">已选 {selected.size} 张</span>
          <button onClick={onClose} disabled={importing}
            className="px-4 py-2.5 rounded-xl text-sm border border-white/10 text-gray-400 hover:bg-white/[0.04] disabled:opacity-40">
            取消
          </button>
          <button onClick={handleImport} disabled={importing || selected.size === 0}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:opacity-90 disabled:opacity-40">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}添加 {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── 新增弹窗：名称 + 描述 + 主图（必备）+ 副图 / 文生图 ── */
function AssetCreateModal({
  projectId, assetType, typeLabel, aspect, onClose, onCreated,
}: {
  projectId: string
  assetType: AssetType
  typeLabel: string
  aspect: string
  onClose: () => void
  onCreated: (a: ProjectAssetRecord) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showT2I, setShowT2I] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [polishingDesc, setPolishingDesc] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePolishDesc = async () => {
    if (!description.trim() || polishingDesc) return
    setPolishingDesc(true); setError('')
    try {
      const polished = await polishPrompt(description.trim(), 'image')
      if (polished) setDescription(polished)
    } catch (e: any) {
      setError(e?.response?.data?.detail || '润色失败，请稍后重试')
    } finally {
      setPolishingDesc(false)
    }
  }

  const addFileList = (arr: File[]) => {
    setFiles(prev => [...prev, ...arr])
    setPreviews(prev => [...prev, ...arr.map(f => URL.createObjectURL(f))])
  }

  const addFiles = (list: FileList | null) => {
    if (!list) return
    addFileList(Array.from(list))
  }

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setPreviews(prev => { URL.revokeObjectURL(prev[idx]); return prev.filter((_, i) => i !== idx) })
  }

  const handleCreate = async () => {
    if (!name.trim()) { setError('请输入名称'); return }
    if (files.length === 0) { setError('请至少上传一张主图（第一张为主图）'); return }
    setLoading(true); setError('')
    try {
      const created = await projectAssetService.createAsset({
        project_id: projectId, asset_type: assetType,
        name: name.trim(), description: description.trim() || undefined, images: files,
      })
      previews.forEach(URL.revokeObjectURL)
      onCreated(created)
    } catch (e: any) {
      setError(e?.response?.data?.detail || '创建失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  // 文生图产出：先落成一张文件加入 files（拉取 task 文件 → File）
  const attachFromTask = async (taskId: string) => {
    setShowT2I(false)
    try {
      const resp = await fetch(`/api/v1/flux/task/${taskId}/file`)
      const blob = await resp.blob()
      const file = new File([blob], `t2i_${taskId}.jpg`, { type: blob.type || 'image/jpeg' })
      addFileList([file])
    } catch {
      setError('文生图结果获取失败')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#14141c] rounded-2xl border border-purple-500/20 w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Plus className="w-4 h-4 text-purple-400" />新增{typeLabel}
          </h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">{typeLabel}名称 *</label>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus
              placeholder={`如：${assetType === 'character' ? '云澈' : assetType === 'scene' ? '仙门大殿' : '仙骨'}`}
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-500">描述</label>
              <button onClick={handlePolishDesc} disabled={polishingDesc || !description.trim()}
                title="AI 一键润色描述"
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-40 border border-indigo-500/20">
                {polishingDesc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}一键润色
              </button>
            </div>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="外观 / 特征 / 用途…"
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40 resize-none" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">图片 *（第一张为主图）</label>
            <div className="grid grid-cols-4 gap-2">
              {previews.map((src, i) => (
                <div key={i} className="group relative aspect-square rounded-lg overflow-hidden border border-white/10">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  {i === 0 && (
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 flex items-center justify-center rounded bg-black/60">
                      <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                    </div>
                  )}
                  <button onClick={() => removeFile(i)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded bg-black/70 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
              <button onClick={() => fileRef.current?.click()}
                className="aspect-square rounded-lg border border-dashed border-white/15 flex flex-col items-center justify-center text-gray-500 hover:text-gray-300 hover:border-white/30">
                <Upload className="w-4 h-4 mb-0.5" /><span className="text-[9px]">上传</span>
              </button>
              <button onClick={() => setShowT2I(true)}
                className="aspect-square rounded-lg border border-dashed border-purple-500/25 flex flex-col items-center justify-center text-purple-400/80 hover:text-purple-300 hover:border-purple-500/50">
                <Sparkles className="w-4 h-4 mb-0.5" /><span className="text-[9px]">文生图</span>
              </button>
              <button onClick={() => setShowPicker(true)}
                className="aspect-square rounded-lg border border-dashed border-white/15 flex flex-col items-center justify-center text-gray-500 hover:text-gray-300 hover:border-white/30">
                <Images className="w-4 h-4 mb-0.5" /><span className="text-[9px]">选作品</span>
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
              onChange={e => { addFiles(e.target.files); if (fileRef.current) fileRef.current.value = '' }} />
          </div>
          {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex-shrink-0 px-5 pb-5 pt-2 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm border border-white/10 text-gray-400 hover:bg-white/[0.04]">
            取消
          </button>
          <button onClick={handleCreate} disabled={loading || !name.trim() || files.length === 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white hover:opacity-90 disabled:opacity-40">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}创建
          </button>
        </div>
      </div>

      {showT2I && (
        <TextToImageModal aspect={aspect} projectId={projectId}
          onClose={() => setShowT2I(false)}
          onGenerated={attachFromTask} />
      )}

      {showPicker && (
        <ImagePickerModal onClose={() => setShowPicker(false)}
          onPick={async (picked) => { addFileList(picked); setShowPicker(false) }} />
      )}
    </div>
  )
}
