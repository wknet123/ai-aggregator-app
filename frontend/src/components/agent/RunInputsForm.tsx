/**
 * RunInputsForm —— 运行时按 Agent.input_schema 渲染的动态输入表单。
 *
 * text/textarea/number/select → 对应控件；image → 文件选择 + 即时预览 + 上传到 MinIO，
 * 上传成功后把返回的 key 存入该字段值（供后端 build_user_text 标注为 image_key 喂给插件）。
 * 值形状：{ [field.key]: string | number }（image 字段值为 MinIO key）。
 */
import { useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { agentService, type InputField } from '../../services/agent.service'

interface Props {
  fields: InputField[]
  values: Record<string, any>
  onChange: (values: Record<string, any>) => void
}

export default function RunInputsForm({ fields, values, onChange }: Props) {
  // 每个 image 字段的本地预览 URL / 上传状态
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [uploadErr, setUploadErr] = useState<Record<string, string>>({})

  const set = (key: string, val: any) => onChange({ ...values, [key]: val })

  const handleFile = async (field: InputField, file: File | undefined) => {
    if (!file) return
    setUploadErr((m) => ({ ...m, [field.key]: '' }))
    setUploading((m) => ({ ...m, [field.key]: true }))
    // 本地即时预览（上传成功与否都先给反馈）
    const localUrl = URL.createObjectURL(file)
    setPreviews((m) => {
      if (m[field.key]) URL.revokeObjectURL(m[field.key])
      return { ...m, [field.key]: localUrl }
    })
    try {
      const { key } = await agentService.uploadRunInput(file)
      set(field.key, key)
    } catch (e: any) {
      setUploadErr((m) => ({ ...m, [field.key]: e?.response?.data?.detail || e?.message || '上传失败' }))
      set(field.key, '')
    } finally {
      setUploading((m) => ({ ...m, [field.key]: false }))
    }
  }

  const clearImage = (field: InputField) => {
    setPreviews((m) => {
      if (m[field.key]) URL.revokeObjectURL(m[field.key])
      const { [field.key]: _, ...rest } = m
      return rest
    })
    set(field.key, '')
  }

  if (!fields.length) return null

  return (
    <div className="space-y-2 mb-2">
      {fields.map((f) => (
        <label key={f.key} className="block">
          <span className="block text-xs text-gray-400 mb-1">
            {f.label || f.key}
            {f.required && <span className="text-pink-400 ml-0.5">*</span>}
          </span>

          {f.type === 'textarea' && (
            <textarea className="input min-h-[60px] text-sm" value={values[f.key] ?? ''}
              placeholder={f.placeholder || ''} onChange={(e) => set(f.key, e.target.value)} />
          )}

          {f.type === 'text' && (
            <input className="input text-sm" value={values[f.key] ?? ''}
              placeholder={f.placeholder || ''} onChange={(e) => set(f.key, e.target.value)} />
          )}

          {f.type === 'number' && (
            <input type="number" className="input text-sm" value={values[f.key] ?? ''}
              placeholder={f.placeholder || ''}
              onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))} />
          )}

          {f.type === 'select' && (
            <select className="input text-sm" value={values[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}>
              <option value="">（请选择）</option>
              {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}

          {f.type === 'image' && (
            <div>
              {previews[f.key] || values[f.key] ? (
                <div className="relative inline-block">
                  <img src={previews[f.key]}
                    className="max-h-32 rounded-lg border border-gray-700 object-contain bg-black/30"
                    alt={f.label} />
                  <button type="button" onClick={() => clearImage(f)}
                    className="absolute -top-2 -right-2 p-0.5 rounded-full bg-gray-800 border border-gray-600 text-gray-300 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                  {uploading[f.key] && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                      <Loader2 className="w-5 h-5 animate-spin text-white" />
                    </div>
                  )}
                </div>
              ) : (
                <label className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg border border-dashed border-gray-700 text-xs text-gray-400 cursor-pointer hover:border-gray-500">
                  {uploading[f.key]
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Upload className="w-4 h-4" />}
                  {uploading[f.key] ? '上传中...' : '选择图片上传'}
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => handleFile(f, e.target.files?.[0])} />
                </label>
              )}
              {uploadErr[f.key] && <p className="text-[11px] text-red-400 mt-1">{uploadErr[f.key]}</p>}
            </div>
          )}

          {f.help && f.type !== 'image' && <p className="text-[11px] text-gray-600 mt-0.5">{f.help}</p>}
        </label>
      ))}
    </div>
  )
}
