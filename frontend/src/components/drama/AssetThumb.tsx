/**
 * 素材缩略图：懒加载后端签名的可预览 URL（/api/v1/drama/asset-preview → ref-asset），
 * 展示为缩略图。用于「拆分分镜」步骤里角色/参考图（分镜自有图片、整集全局图片、整集素材库）
 * 的实际画面预览。object key 归属由后端校验（须为当前用户的 drama 素材键）。
 */
import { useState, useEffect } from 'react'
import { ImageIcon, Loader2 } from 'lucide-react'
import { dramaService } from '../../services/drama.service'

export default function AssetThumb({ objectKey, className = 'w-full h-full object-cover' }: {
  objectKey: string
  className?: string
}) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setUrl(''); setFailed(false)
    dramaService.assetPreviewUrl(objectKey)
      .then(u => { if (alive) setUrl(u) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [objectKey])
  if (failed) return <div className="w-full h-full flex items-center justify-center text-gray-700"><ImageIcon className="w-5 h-5" /></div>
  if (!url) return <div className="w-full h-full flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-600" /></div>
  return <img src={url} alt="" className={className} onError={() => setFailed(true)} />
}
