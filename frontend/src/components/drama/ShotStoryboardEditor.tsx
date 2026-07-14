/**
 * 时间段分镜编辑器（单个镜头）—— 直接呈现完整详情。
 *
 * 时间段由「拆分分镜」步骤统一选时长后 AI 批量草拟（见 OmniWeaverPro.confirmSplit），
 * 本组件不再提供单镜「AI草拟时间段」按钮，也不再内嵌「生成剧创」预览
 * （剧创提示词已上提为全集汇总步骤，见 OmniWeaverPro.PromptsView）。
 *
 * 详情：参考图（角色/事物，带名称）+ 参考视频/音频（带名称）+ 时间段分镜（仅 时间段/时长/动作）。
 * 图片顺序决定 Seedance content 顺序（首帧→尾帧→额外参考），由后端 render_pipeline 消费。
 */
import { useRef, useState, useEffect } from 'react'
import {
  Plus, Trash2, ArrowUp, ArrowDown, Upload, X, ImageIcon, Film, Music,
  Loader2, RotateCcw, AlertCircle, Sparkles, Library, Users, MapPin, Package,
  Maximize2, Play,
} from 'lucide-react'
import { dramaService, EpisodeShot, EpisodeShotImage } from '../../services/drama.service'
import { type Beat, defaultBeats, type ShotSize } from '../../utils/drama-compose'
import AssetPickerModal from './AssetPickerModal'
import AssetThumb from './AssetThumb'
import AssetPreviewModal from './AssetPreviewModal'

// 配置来源徽标：角色/场景/道具 → 图标 + 文案
const ASSET_SRC: Record<'character' | 'scene' | 'prop', { label: string; icon: typeof Users }> = {
  character: { label: '角色', icon: Users },
  scene: { label: '场景', icon: MapPin },
  prop: { label: '道具', icon: Package },
}

export default function ShotStoryboardEditor({
  shot,
  dramaProjectId,
  aspect = '9:16',
  globalImages = [],
  onUpdate,
  disabled,
}: {
  shot: EpisodeShot
  dramaProjectId: string
  aspect?: string
  globalImages?: EpisodeShotImage[]   // 整集全局应用图片（图片1..G），只读展示，本镜自有图片编号顺延
  onUpdate: (patch: Partial<EpisodeShot>) => void
  disabled?: boolean
}) {
  const [error, setError] = useState('')
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null)
  const [polishingBeat, setPolishingBeat] = useState<number | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  // 点击预览：记录待预览素材（图片/视频/音频），弹出灯箱按需拉取签名 URL
  const [preview, setPreview] = useState<{ kind: 'image' | 'video' | 'audio'; key: string; name?: string; label?: string; desc?: string; imageIndex?: number } | null>(null)
  // 删除时间段二次确认：记录待确认的 beat 索引（防误删）
  const [confirmBeatIdx, setConfirmBeatIdx] = useState<number | null>(null)

  const images = shot.images ?? []
  const beats = shot.beats ?? []
  const pendingCount = images.filter(im => im.pending && !im.key).length

  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadTarget = useRef<'image' | 'video' | 'audio' | null>(null)
  const fillSlotIdx = useRef<number | null>(null)   // 非空时：本次图片上传用于填充该 pending 槽

  // ── 上传 ──
  const pickUpload = (target: 'image' | 'video' | 'audio', slotIdx?: number) => {
    uploadTarget.current = target
    fillSlotIdx.current = slotIdx ?? null
    if (uploadRef.current) {
      uploadRef.current.accept = target === 'video' ? 'video/*' : target === 'audio' ? 'audio/*' : 'image/*'
      uploadRef.current.click()
    }
  }
  const onUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const target = uploadTarget.current
    const slotIdx = fillSlotIdx.current
    if (!file || !target) { e.target.value = ''; return }
    setUploadingSlot(target === 'image' && slotIdx !== null ? `image-${slotIdx}` : target)
    setError('')
    try {
      const { object_key, filename } = await dramaService.uploadAsset(file, dramaProjectId, target)
      if (target === 'image') {
        if (slotIdx !== null) {
          // 填充指定 pending 槽（保留其 kind/label 与顺序）
          onUpdate({ images: images.map((x, idx) => idx === slotIdx
            ? { ...x, key: object_key, name: filename, pending: false } : x) })
        } else {
          onUpdate({ images: [...images, { key: object_key, name: filename, kind: 'frame' }] })
        }
      } else if (target === 'video') {
        onUpdate({ reference_video_key: object_key, reference_video_name: filename })
      } else {
        onUpdate({ audio_key: object_key, audio_name: filename })
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || '素材上传失败')
    } finally {
      setUploadingSlot(null)
      fillSlotIdx.current = null
      e.target.value = ''
    }
  }

  // ── 图片操作 ──
  const updateImage = (i: number, patch: Partial<EpisodeShotImage>) =>
    onUpdate({ images: images.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) })
  const removeImage = (i: number) =>
    onUpdate({ images: images.filter((_, idx) => idx !== i) })
  const moveImage = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= images.length) return
    const next = [...images]
    ;[next[i], next[j]] = [next[j], next[i]]
    onUpdate({ images: next })
  }

  // ── 从配置选取：把角色/场景/道具的选中图追加为本镜参考图（角色默认带入全部四视图，各附标题描述）──
  const onPickFromConfig = (sels: { key: string; label: string; caption?: string; desc: string; name: string; assetId: string; assetType: 'character' | 'scene' | 'prop' }[]) => {
    setShowPicker(false)
    if (!sels.length) return
    onUpdate({
      images: [...images, ...sels.map(sel => ({
        key: sel.key, name: sel.name, kind: 'frame' as const,
        label: sel.caption || sel.label, desc: sel.desc,
        assetId: sel.assetId, assetType: sel.assetType,
      }))],
    })
  }

  // ── 时间段：动态链式排布，保证连续且不重叠 ──
  const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1))
  const beatLen = (t?: string): number => {
    const m = /(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/.exec(t || '')
    if (m) { const l = parseFloat(m[2]) - parseFloat(m[1]); return l > 0 ? l : 2 }
    return 2
  }
  const recompute = (bs: Beat[]): Beat[] => {
    let cum = 0
    return bs.map(b => {
      const len = beatLen(b.time)
      const t = `${fmt(cum)}-${fmt(cum + len)}s`
      cum += len
      return { ...b, time: t }
    })
  }
  const totalBeatDur = beats.reduce((s, b) => s + beatLen(b.time), 0)
  // 本镜总时长 = 各时间段时长累加，并同步写回 shot.duration（保持整数，供生成/合并使用）
  const sumLen = (bs: Beat[]) => Math.max(1, Math.round(bs.reduce((s, b) => s + beatLen(b.time), 0)))
  const pushBeats = (bs: Beat[]) => onUpdate({ beats: bs, duration: sumLen(bs) })

  // ── beat 操作（仅 时间段 / 时长 / 动作）──
  const addBeat = () => pushBeats(recompute([...beats, { time: '0-2s', action: '' }]))
  const removeBeat = (i: number) => { setConfirmBeatIdx(null); pushBeats(recompute(beats.filter((_, idx) => idx !== i))) }
  const updateBeat = (i: number, patch: Partial<Beat>) =>
    onUpdate({ beats: beats.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) })
  const setBeatLen = (i: number, len: number) =>
    pushBeats(recompute(beats.map((b, idx) => (idx === i ? { ...b, time: `0-${len}s` } : b))))
  const moveBeat = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= beats.length) return
    const next = [...beats]
    ;[next[i], next[j]] = [next[j], next[i]]
    pushBeats(recompute(next))
  }
  const resetBeats = () => pushBeats(recompute(defaultBeats(shot.duration || 5)))

  // 一键润色：把某时间段的「运镜 + 主体动作」交 AI 润色后回填（仅改该段文字）
  const polishBeat = async (i: number) => {
    const text = beats[i]?.action?.trim()
    if (dis || polishingBeat !== null || !text) return
    setPolishingBeat(i); setError('')
    try {
      const polished = await dramaService.polishText(text, 'action')
      if (polished?.trim()) updateBeat(i, { action: polished })
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'AI 润色失败')
    } finally {
      setPolishingBeat(null)
    }
  }

  const dis = disabled || false
  const gOffset = globalImages.length   // 本镜自有图片编号从 G+1 起（全局图片占 图片1..G）

  return (
    <div className="space-y-4">
      <input ref={uploadRef} type="file" className="hidden" onChange={onUploadFile} />

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {/* ── 详情 ── */}
      {/* 参考图（统一「图片N」，有序，≥1，可命名；序号即提交给 API 的顺序） */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-gray-300">
                参考图（至少 1 张，可命名）
                {pendingCount > 0 && (
                  <span className="ml-2 font-normal text-amber-400/80">{pendingCount} 个待上传槽（按剧本「图片N」预建）</span>
                )}
              </span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowPicker(true)} disabled={dis}
                  title="从「配置」里的角色/场景/道具选取，自动带上命名与形象特征描述"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 border border-purple-500/20 disabled:opacity-40">
                  <Library className="w-3 h-3" />从配置选取
                </button>
                <button onClick={() => pickUpload('image')} disabled={dis || uploadingSlot === 'image'}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 border border-indigo-500/20 disabled:opacity-40">
                  {uploadingSlot === 'image' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}加图片
                </button>
              </div>
            </div>
            {/* 整集全局应用图片（只读）：自动作为本镜 图片1..G，本镜自有图片编号顺延 */}
            {globalImages.length > 0 && (
              <div className="mb-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.05] p-2 space-y-1.5">
                <p className="text-[10px] text-indigo-300 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />已自动引用整集全局图片（来自整集素材库，在「整集全局设定」里管理）
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {globalImages.map((g, i) => (
                    <div key={i} className="rounded-lg bg-[#14141c] border border-indigo-500/20 p-1.5 flex flex-col gap-1">
                      {g.key
                        ? <button type="button" onClick={() => setPreview({ kind: 'image', key: g.key!, name: g.label || g.name })}
                            title="点击预览大图"
                            className="relative group/thumb w-full h-20 rounded-md overflow-hidden border border-white/10 bg-black/30">
                            <AssetThumb objectKey={g.key} className="w-full h-full object-contain" />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/40 transition-colors opacity-0 group-hover/thumb:opacity-100">
                              <Maximize2 className="w-4 h-4 text-white/90" />
                            </span>
                          </button>
                        : <span className="w-full h-20 rounded-md bg-black/30 flex items-center justify-center"><ImageIcon className="w-5 h-5 text-gray-600" /></span>}
                      <div className="flex items-center gap-1 flex-wrap text-[10px] text-gray-300">
                        <span className="px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[9px]">图片{i + 1}</span>
                        <span className="truncate max-w-full">{g.label || g.name || '未命名'}</span>
                        {g.frame && <span className="text-indigo-300/80">{g.frame === 'first' ? '首帧' : '尾帧'}</span>}
                        {g.usage && <span className="text-gray-500">· {g.usage}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {images.length === 0 ? (
              globalImages.length > 0 ? (
                <p className="text-[11px] text-gray-500 flex items-center gap-1 py-1">
                  <AlertCircle className="w-3 h-3" />本镜参考图已由整集全局图片满足；如需本镜专属素材，可再「加图片」（编号从 图片{gOffset + 1} 起）。
                </p>
              ) : (
                <p className="text-[11px] text-amber-400/70 flex items-center gap-1 py-2">
                  <AlertCircle className="w-3 h-3" />至少上传 1 张参考图才能生成本镜（首帧/尾帧请在时间段分镜文字中说明），或在「整集全局设定」里上传全局图片。
                </p>
              )
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {images.map((img, i) => img.pending && !img.key ? (
                  // ── 待上传 pending 槽（按剧本「图片N」预建）──
                  <div key={i} className="rounded-lg border border-dashed border-amber-500/25 bg-amber-500/[0.03] p-2.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] text-amber-300/90 gap-1">
                      <span className="flex items-center gap-1 min-w-0">
                        <ImageIcon className="w-3 h-3 flex-shrink-0" />
                        <span className="px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[9px] flex-shrink-0">图片{i + 1 + gOffset}</span>
                      </span>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => moveImage(i, -1)} disabled={dis} className="text-gray-600 hover:text-gray-300 disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
                        <button onClick={() => moveImage(i, 1)} disabled={dis} className="text-gray-600 hover:text-gray-300 disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
                        <button onClick={() => removeImage(i)} disabled={dis} className="text-gray-600 hover:text-red-400 disabled:opacity-30"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                    <input value={img.label || ''} disabled={dis}
                      onChange={e => updateImage(i, { label: e.target.value })}
                      placeholder={`图片${i + 1 + gOffset}名称/视角（如：林晚的肖像特写）`}
                      className="w-full bg-[#06060e] border border-amber-500/15 rounded-md px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-400/40 disabled:opacity-50" />
                    <button onClick={() => pickUpload('image', i)} disabled={dis || uploadingSlot === `image-${i}`}
                      className="flex items-center justify-center gap-1 rounded-md border border-dashed border-amber-500/30 px-2 py-2 text-[10px] text-amber-300/80 hover:text-amber-200 hover:border-amber-400/50 disabled:opacity-40">
                      {uploadingSlot === `image-${i}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}上传图片{i + 1 + gOffset}
                    </button>
                  </div>
                ) : (
                  <div key={i} className="rounded-lg border border-white/8 bg-[#14141c] p-2.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-300 gap-1">
                      <span className="flex items-center gap-1 min-w-0">
                        <ImageIcon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                        <span className="px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[9px] flex-shrink-0">图片{i + 1 + gOffset}</span>
                        {img.assetType && ASSET_SRC[img.assetType] && (() => {
                          const S = ASSET_SRC[img.assetType!]
                          return (
                            <span title={`来自配置·${S.label}`}
                              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[9px] flex-shrink-0">
                              <S.icon className="w-2.5 h-2.5" />{S.label}
                            </span>
                          )
                        })()}
                        <span className="truncate text-gray-500">{img.name || img.key}</span>
                      </span>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => moveImage(i, -1)} disabled={dis} className="text-gray-600 hover:text-gray-300 disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
                        <button onClick={() => moveImage(i, 1)} disabled={dis} className="text-gray-600 hover:text-gray-300 disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
                        <button onClick={() => removeImage(i)} disabled={dis} className="text-gray-600 hover:text-red-400 disabled:opacity-30"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                    <input value={img.label || ''} disabled={dis}
                      onChange={e => updateImage(i, { label: e.target.value })}
                      placeholder={`图片${i + 1 + gOffset}名称/视角（如：林晚的肖像特写）`}
                      className="w-full bg-[#06060e] border border-indigo-500/15 rounded-md px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 disabled:opacity-50" />
                    {/* 缩略图：点击查看原图 + 编辑标题/描述 */}
                    {img.key && (
                      <button type="button" onClick={() => setPreview({ kind: 'image', key: img.key!, name: img.name, label: img.label, desc: img.desc, imageIndex: i })}
                        title="点击查看原图 / 编辑标题描述"
                        className="relative group/thumb w-full h-28 rounded-md overflow-hidden border border-white/8 bg-black/30">
                        <AssetThumb objectKey={img.key} className="w-full h-full object-contain" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/40 transition-colors opacity-0 group-hover/thumb:opacity-100">
                          <Maximize2 className="w-4 h-4 text-white/90" />
                        </span>
                      </button>
                    )}
                    <textarea value={img.desc || ''} disabled={dis} rows={2}
                      onChange={e => updateImage(i, { desc: e.target.value })}
                      placeholder="形态/特征描述（选填，代入提示词保证外观一致）"
                      className="w-full bg-[#06060e] border border-purple-500/15 rounded-md px-2 py-1 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-400/40 resize-none disabled:opacity-50" />
                    <div className="flex items-center gap-1.5" title="指定本图作为画面首帧/尾帧，将体现在最终提示词；再点取消">
                      <button onClick={() => updateImage(i, { frame: img.frame === 'first' ? undefined : 'first' })} disabled={dis}
                        className={`flex-1 px-1.5 py-1 rounded-md text-[10px] border transition-colors disabled:opacity-40 ${img.frame === 'first' ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50' : 'bg-white/[0.03] text-gray-500 border-white/8 hover:text-gray-300'}`}>
                        首帧
                      </button>
                      <button onClick={() => updateImage(i, { frame: img.frame === 'last' ? undefined : 'last' })} disabled={dis}
                        className={`flex-1 px-1.5 py-1 rounded-md text-[10px] border transition-colors disabled:opacity-40 ${img.frame === 'last' ? 'bg-indigo-500/25 text-indigo-200 border-indigo-400/50' : 'bg-white/[0.03] text-gray-500 border-white/8 hover:text-gray-300'}`}>
                        尾帧
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 参考视频 / 参考音频（各单条可选，带名称） */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <SlotChip
              icon={<Film className="w-3 h-3 text-blue-400" />} label="参考视频（可选）"
              name={shot.reference_video_name} disabled={dis}
              labelValue={shot.reference_video_label} labelPlaceholder="提示词中的名称（如：手持运镜）"
              onLabelChange={v => onUpdate({ reference_video_label: v })}
              uploading={uploadingSlot === 'video'}
              onUpload={() => pickUpload('video')}
              onPreview={shot.reference_video_key ? () => setPreview({ kind: 'video', key: shot.reference_video_key!, name: shot.reference_video_name }) : undefined}
              onClear={() => onUpdate({ reference_video_key: undefined, reference_video_name: undefined, reference_video_label: undefined })}
            />
            <SlotChip
              icon={<Music className="w-3 h-3 text-green-400" />} label="参考音频（可选）"
              name={shot.audio_name} disabled={dis}
              labelValue={shot.audio_label} labelPlaceholder="提示词中的名称（如：欢快BGM）"
              onLabelChange={v => onUpdate({ audio_label: v })}
              uploading={uploadingSlot === 'audio'}
              onUpload={() => pickUpload('audio')}
              onPreview={shot.audio_key ? () => setPreview({ kind: 'audio', key: shot.audio_key!, name: shot.audio_name }) : undefined}
              onClear={() => onUpdate({ audio_key: undefined, audio_name: undefined, audio_label: undefined })}
            />
          </div>

          {/* 时间段分镜 beats（仅 时间段 / 时长 / 动作） */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-gray-300">
                时间段分镜
                <span className={`ml-2 font-normal ${totalBeatDur > 12 ? 'text-amber-400/90' : 'text-gray-600'}`}>
                  本镜总时长 {fmt(totalBeatDur)}s（各时间段时长累加）
                  {totalBeatDur > 12 && '：超过单次生成上限 12s，请缩短或拆成多个分镜'}
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                <button onClick={resetBeats} disabled={dis} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-white/[0.04] text-gray-400 hover:text-gray-200 border border-white/5 disabled:opacity-40">
                  <RotateCcw className="w-3 h-3" />按时长均分
                </button>
                <button onClick={addBeat} disabled={dis} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 border border-indigo-500/20 disabled:opacity-40">
                  <Plus className="w-3 h-3" />添加
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              {beats.length === 0 && (
                <p className="text-[11px] text-amber-400/70 flex items-center gap-1 py-1">
                  <AlertCircle className="w-3 h-3" />请添加至少一段时间段分镜（点「添加」或「AI草拟时间段」）。
                </p>
              )}
              {beats.map((b, i) => (
                <div key={i} className="rounded-lg border border-white/5 bg-[#06060e] p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                    <span className="w-16 flex-shrink-0 text-center bg-[#1a1a2e] border border-white/5 rounded-md px-1 py-1 text-[11px] text-gray-400 font-mono" title="自动排布，连续不重叠">
                      {b.time || '—'}
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-gray-500">
                      时长
                      <select value={beatLen(b.time)} disabled={dis}
                        onChange={e => setBeatLen(i, Number(e.target.value))}
                        className="bg-[#1a1a2e] border border-white/5 rounded-md px-1 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-indigo-500/40 disabled:opacity-50">
                        {[1, 2, 3, 4, 5, 6].map(s => <option key={s} value={s}>{s}s</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1 text-[10px] text-gray-500" title="景别：标准为默认形式，不在提示词中强调">
                      景别
                      <select value={b.shotSize || 'standard'} disabled={dis}
                        onChange={e => updateBeat(i, { shotSize: e.target.value as ShotSize })}
                        className="bg-[#1a1a2e] border border-white/5 rounded-md px-1 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-indigo-500/40 disabled:opacity-50">
                        <option value="standard">标准</option>
                        <option value="closeup">近景</option>
                        <option value="wide">远景</option>
                        <option value="extreme">特写</option>
                      </select>
                    </label>
                    <div className="flex-1" />
                    <button onClick={() => polishBeat(i)} disabled={dis || polishingBeat !== null || !b.action?.trim()}
                      title="AI 一键润色本段动作描述"
                      className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] text-indigo-300 border border-indigo-500/20 bg-indigo-500/10 hover:bg-indigo-500/20 disabled:opacity-30 flex-shrink-0">
                      {polishingBeat === i ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}润色
                    </button>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button onClick={() => moveBeat(i, -1)} disabled={dis} className="text-gray-600 hover:text-gray-300 disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
                      <button onClick={() => moveBeat(i, 1)} disabled={dis} className="text-gray-600 hover:text-gray-300 disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
                      {confirmBeatIdx === i ? (
                        <span className="flex items-center gap-1 ml-0.5">
                          <button onClick={() => removeBeat(i)} disabled={dis}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40">确认删除</button>
                          <button onClick={() => setConfirmBeatIdx(null)}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-500 hover:bg-white/10">取消</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmBeatIdx(i)} disabled={dis} title="删除本时间段"
                          className="text-gray-600 hover:text-red-400 disabled:opacity-30"><Trash2 className="w-3 h-3" /></button>
                      )}
                    </div>
                  </div>
                  <textarea value={b.action} disabled={dis}
                    onChange={e => updateBeat(i, { action: e.target.value })} rows={2} placeholder="运镜 + 主体动作"
                    className="w-full bg-[#1a1a2e] border border-white/5 rounded-md px-2 py-1.5 text-[11px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 resize-none disabled:opacity-50" />
                </div>
              ))}
            </div>
          </div>

      {showPicker && (
        <AssetPickerModal projectId={dramaProjectId}
          onClose={() => setShowPicker(false)} onPick={onPickFromConfig} />
      )}
      {preview && (
        <AssetPreviewModal kind={preview.kind} objectKey={preview.key} name={preview.name}
          label={preview.label} desc={preview.desc}
          editable={preview.imageIndex != null}
          onSave={preview.imageIndex != null ? (patch) => updateImage(preview.imageIndex!, patch) : undefined}
          onClose={() => setPreview(null)} />
      )}
    </div>
  )
}

function SlotChip({ icon, label, name, uploading, disabled, labelValue, labelPlaceholder, onLabelChange, onUpload, onPreview, onClear }: {
  icon: React.ReactNode; label: string; name?: string; uploading: boolean; disabled: boolean
  labelValue?: string; labelPlaceholder: string; onLabelChange: (v: string) => void
  onUpload: () => void; onPreview?: () => void; onClear: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-white/8 bg-[#14141c] p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-300">{icon}{label}</div>
      {name ? (
        <>
          <div className="flex items-center gap-1.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 text-[10px] text-indigo-200">
            <span className="truncate flex-1">{name}</span>
            {onPreview && (
              <button onClick={onPreview} title="点击预览" className="text-indigo-300 hover:text-indigo-100"><Play className="w-3 h-3" /></button>
            )}
            <button onClick={onClear} disabled={disabled} className="text-gray-400 hover:text-red-300 disabled:opacity-40"><X className="w-3 h-3" /></button>
          </div>
          <input value={labelValue || ''} disabled={disabled}
            onChange={e => onLabelChange(e.target.value)} placeholder={labelPlaceholder}
            className="w-full bg-[#06060e] border border-indigo-500/15 rounded-md px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 disabled:opacity-50" />
        </>
      ) : (
        <button onClick={onUpload} disabled={disabled || uploading}
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-white/15 px-2 py-2 text-[10px] text-gray-500 hover:text-gray-300 hover:border-white/30 disabled:opacity-40">
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}上传
        </button>
      )}
    </div>
  )
}

/** 素材缩略图：懒加载签名 URL 展示（默认 object-contain 完整显示，不裁切）。已抽取到 ./AssetThumb，此处复用。 */
/** 素材预览灯箱（查看原图 + 可选标题/描述编辑）已抽取到 ./AssetPreviewModal，此处复用。 */

