import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { douyinService } from '../services/douyin.service'

export default function DouyinCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code || !state) {
      setStatus('error')
      setError('Missing code or state parameter')
      return
    }

    douyinService
      .handleCallback(code, state)
      .then(() => {
        setStatus('success')

        // Notify opener window via postMessage
        if (window.opener) {
          window.opener.postMessage(
            { type: 'douyin-callback', success: true },
            window.location.origin
          )
          setTimeout(() => window.close(), 1500)
        } else {
          setTimeout(() => navigate('/gallery'), 2000)
        }
      })
      .catch((err: any) => {
        setStatus('error')
        setError(err.message || 'Callback failed')
      })
  }, [searchParams, navigate])

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="w-10 h-10 animate-spin text-pink-400 mx-auto" />
            <p className="text-gray-400 text-sm">正在连接抖音账号...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto" />
            <p className="text-gray-200 text-sm">连接成功!</p>
            <p className="text-gray-500 text-xs">窗口将自动关闭</p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
            <p className="text-gray-200 text-sm">连接失败</p>
            <p className="text-red-400 text-xs">{error}</p>
          </>
        )}
      </div>
    </div>
  )
}
