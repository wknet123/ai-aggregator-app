import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { adminGatewayService } from '@/services/adminGateway.service'
import type { GatewayConfig, UserMapping } from '@/types/gatewayConfig.types'
import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import {
  Server, Plus, Star, Trash2, Loader2, Save, X, Users, ShieldCheck,
} from 'lucide-react'

interface EditForm {
  id?: number
  name: string
  base_url: string
  api_key: string
  is_active: boolean
}

const EMPTY_FORM: EditForm = { name: '', base_url: '', api_key: '', is_active: true }

export default function AdminGateway() {
  useDocumentTitle('网关管理')
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [configs, setConfigs] = useState<GatewayConfig[]>([])
  const [mappings, setMappings] = useState<UserMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  // 配置编辑表单（新建或编辑）
  const [editing, setEditing] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)

  // 非 admin 直接重定向
  useEffect(() => {
    if (user && !user.is_admin) navigate('/gallery')
  }, [user, navigate])

  const loadAll = async () => {
    setLoading(true)
    setErr('')
    try {
      const [cfgs, maps] = await Promise.all([
        adminGatewayService.listConfigs(),
        adminGatewayService.listUserMappings(1, 200),
      ])
      setConfigs(cfgs)
      setMappings(maps.items)
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 3000)
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.name.trim() || !editing.base_url.trim()) {
      setErr('名称和 Base URL 不能为空')
      return
    }
    setSaving(true)
    setErr('')
    try {
      if (editing.id) {
        await adminGatewayService.updateConfig(editing.id, {
          name: editing.name.trim(),
          base_url: editing.base_url.trim(),
          api_key: editing.api_key.trim() || undefined, // 留空=不改
          is_active: editing.is_active,
        })
        flash('已更新')
      } else {
        if (!editing.api_key.trim()) {
          setErr('新建配置必须填写 API Key')
          setSaving(false)
          return
        }
        await adminGatewayService.createConfig({
          name: editing.name.trim(),
          base_url: editing.base_url.trim(),
          api_key: editing.api_key.trim(),
          is_active: editing.is_active,
        })
        flash('已创建')
      }
      setEditing(null)
      await loadAll()
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSetDefault = async (id: number) => {
    setErr('')
    try {
      await adminGatewayService.setDefault(id)
      flash('已设为默认组')
      await loadAll()
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '操作失败')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除该网关配置？')) return
    setErr('')
    try {
      await adminGatewayService.deleteConfig(id)
      flash('已删除')
      await loadAll()
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '删除失败')
    }
  }

  const handleMappingChange = async (userId: number, value: string) => {
    setErr('')
    const cid = value === '' ? null : Number(value)
    try {
      await adminGatewayService.setUserMapping(userId, cid)
      setMappings((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, gateway_config_id: cid } : m))
      )
      flash('已更新映射')
    } catch (e: any) {
      setErr(e?.response?.data?.detail || '更新映射失败')
      await loadAll()
    }
  }

  const inputCls =
    'w-full px-4 py-2.5 bg-[#1a1a1f] border border-gray-700/50 rounded-xl text-gray-100 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 transition-all placeholder:text-gray-600 text-sm'

  return (
    <div className="min-h-screen bg-[#0d0d0f]">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex h-[calc(100vh-56px)] md:h-[calc(100vh-64px)] overflow-hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 h-full overflow-y-auto bg-[#0d0d0f] p-4 md:p-8">
          <div className="w-full max-w-5xl">
            {/* Page Header */}
            <div className="mb-6 md:mb-8">
              <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2 md:gap-3">
                <span className="bg-gradient-to-r from-pink-500 to-purple-500 p-1.5 md:p-2 rounded-xl text-white">
                  <ShieldCheck className="w-5 h-5 md:w-6 md:h-6" strokeWidth={1.5} />
                </span>
                网关管理
              </h1>
              <p className="text-gray-500 mt-1 md:mt-2 text-sm md:text-base">
                配置多组 AI 网关凭证，并映射给不同用户使用（管理员专用）
              </p>
            </div>

            {(err || msg) && (
              <div
                className={`mb-4 text-sm rounded-lg px-3 py-2 border ${
                  err
                    ? 'text-red-400 bg-red-500/10 border-red-500/20'
                    : 'text-green-400 bg-green-500/10 border-green-500/20'
                }`}
              >
                {err || msg}
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
              </div>
            ) : (
              <>
                {/* 网关配置 */}
                <div className="bg-[#16161a] border border-gray-800/50 rounded-2xl p-4 md:p-6 mb-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg md:text-xl font-bold text-gray-100 flex items-center gap-2">
                      <Server className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                      网关配置
                    </h2>
                    {!editing && (
                      <button
                        onClick={() => setEditing({ ...EMPTY_FORM })}
                        className="flex items-center gap-1.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-pink-500/20 transition-all"
                      >
                        <Plus className="w-4 h-4" /> 新建配置
                      </button>
                    )}
                  </div>

                  {/* 编辑表单 */}
                  {editing && (
                    <div className="mb-4 p-4 bg-[#1a1a1f] rounded-xl border border-gray-800/50 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">名称</label>
                          <input
                            className={inputCls}
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            placeholder="如：主网关 / 备用网关"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-400 mb-1">Base URL</label>
                          <input
                            className={inputCls}
                            value={editing.base_url}
                            onChange={(e) => setEditing({ ...editing, base_url: e.target.value })}
                            placeholder="https://neolink.com/api/v1"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">
                          API Key {editing.id && <span className="text-gray-600">（留空表示不修改）</span>}
                        </label>
                        <input
                          className={inputCls}
                          type="password"
                          value={editing.api_key}
                          onChange={(e) => setEditing({ ...editing, api_key: e.target.value })}
                          placeholder={editing.id ? '••••（不改则留空）' : '输入网关 API Key'}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-400">
                        <input
                          type="checkbox"
                          checked={editing.is_active}
                          onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                          className="accent-pink-500"
                        />
                        启用
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="flex items-center gap-1.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white px-5 py-2 rounded-xl text-sm font-medium hover:shadow-lg hover:shadow-pink-500/20 transition-all disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          保存
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-400 border border-gray-700/50 hover:bg-white/5 rounded-xl transition-colors"
                        >
                          <X className="w-4 h-4" /> 取消
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 配置列表 */}
                  <div className="space-y-2">
                    {configs.length === 0 && (
                      <p className="text-sm text-gray-500">暂无网关配置</p>
                    )}
                    {configs.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-3 bg-[#1a1a1f] rounded-xl border border-gray-800/50"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-200 truncate">{c.name}</span>
                            {c.is_default && (
                              <span className="inline-flex items-center gap-1 text-[10px] bg-gradient-to-r from-pink-500 to-purple-500 text-white px-1.5 py-0.5 rounded-full">
                                <Star className="w-3 h-3" /> 默认
                              </span>
                            )}
                            {!c.is_active && (
                              <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">
                                已停用
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{c.base_url}</p>
                          <p className="text-xs text-gray-600">Key: {c.api_key_masked}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!c.is_default && (
                            <button
                              onClick={() => handleSetDefault(c.id)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 rounded-lg transition-colors"
                            >
                              <Star className="w-3.5 h-3.5" /> 设默认
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setEditing({
                                id: c.id,
                                name: c.name,
                                base_url: c.base_url,
                                api_key: '',
                                is_active: c.is_active,
                              })
                            }
                            className="px-2.5 py-1.5 text-xs text-gray-300 border border-gray-700/50 hover:bg-white/5 rounded-lg transition-colors"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            disabled={c.is_default}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-400 border border-red-500/20 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 用户映射 */}
                <div className="bg-[#16161a] border border-gray-800/50 rounded-2xl p-4 md:p-6">
                  <h2 className="text-lg md:text-xl font-bold text-gray-100 mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                    用户映射
                  </h2>
                  <p className="text-sm text-gray-500 mb-3">
                    为用户指定使用的网关配置；不指定（默认组）时使用标记为默认的那组。
                  </p>
                  <div className="space-y-2">
                    {mappings.map((m) => (
                      <div
                        key={m.user_id}
                        className="flex items-center justify-between p-3 bg-[#1a1a1f] rounded-xl border border-gray-800/50 gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-200 truncate">{m.username}</span>
                            {m.is_admin && (
                              <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">
                                admin
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{m.email}</p>
                        </div>
                        <select
                          value={m.gateway_config_id ?? ''}
                          onChange={(e) => handleMappingChange(m.user_id, e.target.value)}
                          className="px-3 py-2 bg-[#0d0d0f] border border-gray-700/50 rounded-lg text-gray-200 text-sm focus:border-pink-500 focus:ring-2 focus:ring-pink-500/30 shrink-0"
                        >
                          <option value="">默认组</option>
                          {configs
                            .filter((c) => c.is_active)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {c.is_default ? '（默认）' : ''}
                              </option>
                            ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
