/**
 * RunDetail —— 单个 Run 的详情：轮询、步骤时间线、人工确认（continue/edit/skip/abort）、
 * 产物预览（图/视频经鉴权 blob 端点取流）。
 */
import { useEffect, useRef, useState } from 'react'
import {
  Loader2, Check, SkipForward, Ban, Pencil, RefreshCw, Ban as CancelIcon,
} from 'lucide-react'
import {
  agentService, type AgentRun, type AgentArtifact, type RunStatus,
} from '../../services/agent.service'

const ACTIVE: RunStatus[] = ['pending', 'planning', 'running', 'awaiting_confirmation']

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-300',
  planning: 'bg-blue-500/20 text-blue-300',
  running: 'bg-blue-500/20 text-blue-300',
  awaiting_confirmation: 'bg-amber-500/20 text-amber-300',
  completed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-gray-600/30 text-gray-400',
}

const STATUS_LABEL: Record<string, string> = {
  pending: '排队中', planning: '规划中', running: '运行中',
  awaiting_confirmation: '待确认', completed: '已完成', failed: '失败', cancelled: '已取消',
}

interface Props {
  runId: string
  onChanged?: () => void          // 状态变化时通知父组件刷新历史列表
}

export default function RunDetail({ runId, onChanged }: Props) {
  const [run, setRun] = useState<AgentRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<number | null>(null)
  const lastStatus = useRef<string>('')

  const load = async () => {
    try {
      const r = await agentService.getRun(runId)
      setRun(r)
      if (r.status !== lastStatus.current) {
        lastStatus.current = r.status
        onChanged?.()
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  // 切换 run / 轮询
  useEffect(() => {
    setLoading(true)
    setError('')
    lastStatus.current = ''
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    if (run && ACTIVE.includes(run.status)) {
      timer.current = window.setInterval(load, 2000)
    }
    return () => { if (timer.current) clearInterval(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, runId])

  const doCancel = async () => {
    setBusy(true)
    try { await agentService.cancelRun(runId); await load() }
    catch (e: any) { setError(e?.response?.data?.detail || '取消失败') }
    finally { setBusy(false) }
  }

  const doConfirm = async (
    action: 'continue' | 'edit' | 'skip' | 'abort',
    extra?: { edited_args?: Record<string, Record<string, any>>; reason?: string },
  ) => {
    setBusy(true)
    setError('')
    try {
      await agentService.confirmRun(runId, { action, ...extra })
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.detail || '确认失败')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !run) {
    return <div className="flex items-center justify-center h-40 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
  }
  if (!run) {
    return <div className="text-sm text-red-400">{error || 'Run 不存在'}</div>
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[run.status] || 'bg-gray-500/20 text-gray-300'}`}>
              {STATUS_LABEL[run.status] || run.status}
            </span>
            <span className="text-xs text-gray-500">进度 {run.progress ?? 0}%</span>
            <span className="text-xs text-gray-500">花费 {run.total_cost ?? 0}</span>
            <span className="text-xs text-gray-500">确认模式 {run.confirm_mode || 'auto'}</span>
          </div>
          <p className="mt-1.5 text-sm text-gray-200 break-words">{run.goal}</p>
          <p className="text-[11px] text-gray-600 mt-0.5">智能体 {run.agent_key} · {run.run_id}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-white/10" title="刷新">
            <RefreshCw className="w-4 h-4 text-gray-400" />
          </button>
          {ACTIVE.includes(run.status) && (
            <button onClick={doCancel} disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-50">
              <CancelIcon className="w-3.5 h-3.5" />取消
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
      {run.error_message && (
        <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">错误：{run.error_message}</div>
      )}

      {/* 人工确认区 */}
      {run.status === 'awaiting_confirmation' && run.pending_confirmation && (
        <ConfirmPanel pc={run.pending_confirmation} busy={busy} onConfirm={doConfirm} />
      )}

      {/* 产物 */}
      {run.final_artifacts && run.final_artifacts.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-400 mb-2">产物（{run.final_artifacts.length}）</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {run.final_artifacts.map((a, i) => (
              <ArtifactCard key={i} runId={runId} artifact={a} />
            ))}
          </div>
        </div>
      )}

      {/* 步骤时间线 */}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 mb-2">执行步骤（{run.steps?.length ?? 0}）</h4>
        <div className="space-y-2">
          {(run.steps || []).map((s) => (
            <details key={s.step_index} className="rounded-lg border border-gray-800/60 bg-[#101014] px-3 py-2">
              <summary className="flex items-center gap-2 cursor-pointer text-xs">
                <span className="text-gray-500">#{s.step_index}</span>
                <span className="text-gray-300">{s.type}{s.plugin_name ? ` · ${s.plugin_name}` : ''}</span>
                <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] ${
                  s.status === 'completed' ? 'bg-green-500/15 text-green-300'
                  : s.status === 'skipped' ? 'bg-gray-500/20 text-gray-400'
                  : s.status === 'failed' ? 'bg-red-500/15 text-red-300'
                  : 'bg-blue-500/15 text-blue-300'}`}>{s.status}</span>
              </summary>
              <div className="mt-2 space-y-1.5 text-[11px]">
                {s.thought && <p className="text-gray-400 whitespace-pre-wrap">{s.thought}</p>}
                {s.input_data != null && <JsonBlock label="输入" data={s.input_data} />}
                {s.output_data != null && <JsonBlock label="输出" data={s.output_data} />}
                {s.error_message && <p className="text-red-400">错误：{s.error_message}</p>}
              </div>
            </details>
          ))}
          {(!run.steps || run.steps.length === 0) && <p className="text-xs text-gray-600">暂无步骤</p>}
        </div>
      </div>
    </div>
  )
}

// ── 人工确认面板 ─────────────────────────────────────────────────────────────
function ConfirmPanel({
  pc, busy, onConfirm,
}: {
  pc: NonNullable<AgentRun['pending_confirmation']>
  busy: boolean
  onConfirm: (a: 'continue' | 'edit' | 'skip' | 'abort',
    extra?: { edited_args?: Record<string, Record<string, any>>; reason?: string }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [edited, setEdited] = useState<Record<string, string>>({})   // {tool_call_id: JSON string}
  const [reason, setReason] = useState('')
  const [jsonErr, setJsonErr] = useState('')

  const startEdit = () => {
    const init: Record<string, string> = {}
    for (const it of pc.pending) init[it.tool_call_id] = JSON.stringify(it.args, null, 2)
    setEdited(init)
    setEditing(true)
  }

  const submitEdit = () => {
    const out: Record<string, Record<string, any>> = {}
    for (const [id, txt] of Object.entries(edited)) {
      try { out[id] = JSON.parse(txt || '{}') }
      catch (e: any) { setJsonErr(`参数 JSON 非法（${id}）：${e?.message || ''}`); return }
    }
    setJsonErr('')
    onConfirm('edit', { edited_args: out })
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <p className="text-sm text-amber-200 mb-3">{pc.message}</p>
      <div className="space-y-2 mb-3">
        {pc.pending.map((it) => (
          <div key={it.tool_call_id} className="rounded-lg bg-[#16161a] border border-gray-800/60 p-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-200 font-medium">{it.label}</span>
              <span className="text-gray-500">({it.name})</span>
              <span className="ml-auto text-amber-300">预估花费 {it.cost}</span>
            </div>
            {editing ? (
              <textarea
                className="input mt-2 min-h-[80px] font-mono text-[11px]"
                value={edited[it.tool_call_id] ?? ''}
                onChange={(e) => setEdited((m) => ({ ...m, [it.tool_call_id]: e.target.value }))}
              />
            ) : (
              <JsonBlock label="参数" data={it.args} />
            )}
          </div>
        ))}
      </div>

      {jsonErr && <p className="text-xs text-red-400 mb-2">{jsonErr}</p>}

      {editing ? (
        <div className="flex gap-2">
          <button onClick={submitEdit} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-pink-500/80 text-white hover:bg-pink-500 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" />提交修改并执行
          </button>
          <button onClick={() => setEditing(false)} disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs text-gray-300 hover:bg-white/10">取消编辑</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => onConfirm('continue')} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-green-500/20 text-green-300 hover:bg-green-500/30 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" />继续
          </button>
          <button onClick={startEdit} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50">
            <Pencil className="w-3.5 h-3.5" />修改参数
          </button>
          <button onClick={() => onConfirm('skip', { reason: reason || undefined })} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-gray-500/20 text-gray-300 hover:bg-gray-500/30 disabled:opacity-50">
            <SkipForward className="w-3.5 h-3.5" />跳过
          </button>
          <button onClick={() => onConfirm('abort')} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-50">
            <Ban className="w-3.5 h-3.5" />终止
          </button>
          <input className="input flex-1 min-w-[160px] !py-1.5 text-xs" placeholder="跳过原因（可选）"
            value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
    </div>
  )
}

// ── 产物卡片（鉴权 blob 取流）───────────────────────────────────────────────
function ArtifactCard({ runId, artifact }: { runId: string; artifact: AgentArtifact }) {
  const [url, setUrl] = useState<string>('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let revoked = ''
    let alive = true
    if (artifact.key && (artifact.type === 'image' || artifact.type === 'video')) {
      agentService.artifactObjectUrl(runId, artifact.key)
        .then((u) => { if (alive) { setUrl(u); revoked = u } else URL.revokeObjectURL(u) })
        .catch((e) => { if (alive) setErr(e?.message || '加载失败') })
    }
    return () => { alive = false; if (revoked) URL.revokeObjectURL(revoked) }
  }, [runId, artifact.key, artifact.type])

  return (
    <div className="rounded-lg border border-gray-800/60 bg-[#101014] overflow-hidden">
      <div className="aspect-video bg-black/40 flex items-center justify-center">
        {artifact.type === 'image' && url && <img src={url} alt="" className="max-w-full max-h-full object-contain" />}
        {artifact.type === 'video' && url && <video src={url} controls className="max-w-full max-h-full" />}
        {!url && !err && (artifact.type === 'image' || artifact.type === 'video') &&
          <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />}
        {err && <span className="text-[11px] text-red-400 px-2 text-center">{err}</span>}
        {artifact.type !== 'image' && artifact.type !== 'video' &&
          <span className="text-xs text-gray-500 uppercase">{artifact.type}</span>}
      </div>
      {artifact.note && <p className="text-[11px] text-gray-400 px-2 py-1.5 line-clamp-2">{artifact.note}</p>}
    </div>
  )
}

function JsonBlock({ label, data }: { label: string; data: any }) {
  return (
    <div>
      <span className="text-gray-500">{label}：</span>
      <pre className="mt-0.5 bg-black/30 rounded px-2 py-1 overflow-x-auto text-[10px] text-gray-300 whitespace-pre-wrap break-all">
        {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}
