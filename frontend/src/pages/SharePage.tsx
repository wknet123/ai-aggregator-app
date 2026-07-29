import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { Download, Sparkles, AlertCircle } from 'lucide-react'
import { googleService, type SharedWork } from '../services/google.service'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function SharePage() {
  useDocumentTitle('分享作品')

  const { taskId } = useParams<{ taskId: string }>()
  const [searchParams] = useSearchParams()
  const exp = searchParams.get('exp') || ''
  const sig = searchParams.get('sig') || ''

  const [work, setWork] = useState<SharedWork | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!taskId || !exp || !sig) {
        setError(true)
        setLoading(false)
        return
      }
      try {
        const data = await googleService.getSharedWork(taskId, exp, sig)
        if (!cancelled) setWork(data)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [taskId, exp, sig])

  const handleDownload = () => {
    if (!work) return
    const link = document.createElement('a')
    link.href = googleService.getResultUrl(work.result_url)
    link.download = `${work.task_id}.${work.task_type === 'video' ? 'mp4' : 'jpg'}`
    link.click()
  }

  const modelName = work?.model_id
    ? work.model_id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'AI'

  return (
    <div className="min-h-screen bg-[#0d0d0f] flex flex-col">
      {/* Brand header */}
      <header className="flex items-center justify-between px-4 md:px-8 py-4 border-b border-gray-800/50">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="logo" className="w-7 h-7" />
          <span className="text-white font-semibold text-lg">AI创作平台</span>
        </Link>
        <Link
          to="/"
          className="text-sm px-4 py-1.5 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:from-pink-600 hover:to-purple-600 transition-all"
        >
          去创作
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 md:p-8">
        {loading ? (
          <div className="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
        ) : error || !work ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-12 h-12 text-gray-500" />
            <p className="text-gray-300 text-lg">链接已失效或作品已设为私有</p>
            <p className="text-gray-500 text-sm">请向分享者索取新的链接</p>
            <Link
              to="/"
              className="mt-2 text-sm px-5 py-2 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:from-pink-600 hover:to-purple-600 transition-all"
            >
              去创作
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 max-w-4xl w-full">
            {/* Media */}
            {work.task_type === 'video' ? (
              <div className="rounded-2xl overflow-hidden border-2 border-pink-500/30 shadow-2xl shadow-pink-500/10 bg-black">
                <video
                  src={googleService.getResultUrl(work.result_url)}
                  className="w-full h-auto max-h-[calc(100vh-260px)] object-contain"
                  controls
                  autoPlay
                  playsInline
                />
              </div>
            ) : (
              <img
                src={googleService.getResultUrl(work.result_url)}
                alt={work.prompt || '分享作品'}
                className="max-w-full max-h-[calc(100vh-260px)] object-contain rounded-xl border border-gray-800/50"
              />
            )}

            {/* Meta + actions */}
            <div className="w-full max-w-2xl flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/30">
                  <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                  <span className="text-xs text-pink-300">{modelName}</span>
                </div>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#1a1a1f] hover:bg-[#252530] border border-gray-700/50 text-gray-200 text-sm transition-all"
                >
                  <Download className="w-4 h-4" />
                  下载
                </button>
              </div>
              {work.prompt && (
                <p className="text-gray-400 text-sm leading-relaxed whitespace-pre-wrap">
                  {work.prompt}
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
