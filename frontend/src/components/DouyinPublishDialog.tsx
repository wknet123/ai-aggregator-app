import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, CheckCircle2, AlertCircle, Unlink } from 'lucide-react'
import { douyinService, DouyinPublishStatus } from '../services/douyin.service'

interface DouyinPublishDialogProps {
  open: boolean
  onClose: () => void
  taskId: string | null
  videoUrl: string | null
}

const STEP_LABELS = ['上传中...', '发布中...', '完成']

export default function DouyinPublishDialog({ open, onClose, taskId, videoUrl }: DouyinPublishDialogProps) {
  const [connected, setConnected] = useState(false)
  const [nickname, setNickname] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishStatus, setPublishStatus] = useState<DouyinPublishStatus | null>(null)
  const [error, setError] = useState('')

  // Check connection status on open
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    setPublishStatus(null)
    setPublishing(false)
    douyinService.getConnection()
      .then((conn) => {
        setConnected(conn.connected)
        setNickname(conn.nickname || null)
      })
      .catch(() => setConnected(false))
      .finally(() => setLoading(false))
  }, [open])

  // Listen for OAuth callback postMessage
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.data?.type === 'douyin-callback' && event.data?.success) {
        setConnected(true)
        setNickname(event.data.nickname || null)
      }
    },
    []
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  const handleConnect = async () => {
    try {
      const url = await douyinService.getAuthUrl()
      window.open(url, 'douyin_oauth', 'width=600,height=700')
    } catch (err: any) {
      setError(err.message || 'Failed to get auth URL')
    }
  }

  const handleDisconnect = async () => {
    try {
      await douyinService.disconnect()
      setConnected(false)
      setNickname(null)
    } catch (err: any) {
      setError(err.message || 'Disconnect failed')
    }
  }

  const handlePublish = async () => {
    if (!taskId || !title.trim()) return

    setPublishing(true)
    setError('')
    setPublishStatus(null)

    try {
      const { publish_id } = await douyinService.publish({
        task_id: taskId,
        title: title.trim(),
      })

      await douyinService.pollPublishStatus(publish_id, (status) => {
        setPublishStatus(status)
      })
    } catch (err: any) {
      setError(err.message || 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#14141c] border border-purple-500/10 rounded-2xl shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
              <path d="M16.6 5.82s.51.5 0 0A4.278 4.278 0 0 1 19.5 2h1v4.5a5 5 0 0 1-5 5h-.5v5a4 4 0 1 1-4-4v2a2 2 0 1 0 2 2V2h3.5c0 1.5.64 3.03 1.1 3.82Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-pink-400" />
            </svg>
            发布到抖音
          </h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
            </div>
          ) : !connected ? (
            /* ── Not Connected ── */
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 mx-auto bg-pink-500/10 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
                  <path d="M16.6 5.82s.51.5 0 0A4.278 4.278 0 0 1 19.5 2h1v4.5a5 5 0 0 1-5 5h-.5v5a4 4 0 1 1-4-4v2a2 2 0 1 0 2 2V2h3.5c0 1.5.64 3.03 1.1 3.82Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-pink-400" />
                </svg>
              </div>
              <p className="text-sm text-gray-400">请先连接你的抖音账号</p>
              <button
                onClick={handleConnect}
                className="px-6 py-2.5 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                连接抖音账号
              </button>
            </div>
          ) : publishStatus?.status === 'completed' ? (
            /* ── Publish Complete ── */
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
              <p className="text-gray-200 font-medium">发布成功!</p>
              <p className="text-xs text-gray-500">视频已成功发布到抖音</p>
              <button
                onClick={onClose}
                className="mt-2 px-5 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-gray-300 transition-colors"
              >
                关闭
              </button>
            </div>
          ) : publishStatus?.status === 'failed' ? (
            /* ── Publish Failed ── */
            <div className="text-center py-6 space-y-3">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
              <p className="text-gray-200 font-medium">发布失败</p>
              <p className="text-xs text-red-400">{publishStatus.error || '未知错误'}</p>
              <button
                onClick={() => { setPublishStatus(null); setPublishing(false) }}
                className="mt-2 px-5 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-gray-300 transition-colors"
              >
                重试
              </button>
            </div>
          ) : publishing ? (
            /* ── Publishing Progress ── */
            <div className="py-6 space-y-5">
              <div className="flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-pink-400" />
              </div>
              <div className="flex items-center justify-center gap-6">
                {STEP_LABELS.map((label, i) => {
                  const step = publishStatus?.step ?? 0
                  const isActive = step === i + 1
                  const isDone = step > i + 1 || publishStatus?.status === 'completed'
                  return (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className={`w-3 h-3 rounded-full ${isDone ? 'bg-green-400' : isActive ? 'bg-pink-400 animate-pulse' : 'bg-gray-700'}`} />
                      <span className={`text-xs ${isActive ? 'text-pink-300' : isDone ? 'text-green-300' : 'text-gray-600'}`}>
                        {label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            /* ── Connected - Publish Form ── */
            <>
              {/* Account info */}
              <div className="flex items-center justify-between bg-white/[0.03] rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-pink-500/20 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <path d="M16.6 5.82s.51.5 0 0A4.278 4.278 0 0 1 19.5 2h1v4.5a5 5 0 0 1-5 5h-.5v5a4 4 0 1 1-4-4v2a2 2 0 1 0 2 2V2h3.5c0 1.5.64 3.03 1.1 3.82Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-pink-400" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-sm text-gray-200">{nickname || '抖音账号'}</span>
                    <span className="block text-xs text-green-400">已连接</span>
                  </div>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  <Unlink className="w-3 h-3" />
                  解绑
                </button>
              </div>

              {/* Video preview */}
              {videoUrl && (
                <video
                  src={videoUrl}
                  controls
                  className="w-full max-h-[200px] rounded-xl bg-black object-contain"
                />
              )}

              {/* Title input */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">视频标题</label>
                <textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="输入视频标题/描述..."
                  maxLength={100}
                  className="w-full h-20 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/40 resize-none text-sm"
                />
                <p className="text-right text-xs text-gray-600 mt-1">{title.length}/100</p>
              </div>

              {/* Publish button */}
              <button
                onClick={handlePublish}
                disabled={!title.trim() || !taskId}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                  !title.trim() || !taskId
                    ? 'bg-gray-800/80 text-gray-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-pink-500 to-rose-500 text-white hover:opacity-90 shadow-lg shadow-pink-500/20'
                }`}
              >
                发布到抖音
              </button>
            </>
          )}

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
