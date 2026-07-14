/**
 * InputFieldsEditor —— 结构化「输入字段」编排器（替代手写 JSON）。
 *
 * 复用于：AgentEditor 的「用户输入定义」（含 image 上传类型）、SkillEditor 的 inputs 槽。
 * 每行一个字段：key / 标签 / 类型 / 必填 / 占位说明；type=select 额外配置候选项。
 * 值形状对齐后端 Agent.input_schema 与 Skill.inputs：[{key,label,type,required,placeholder,options}]。
 */
import { Plus, Trash2, GripVertical } from 'lucide-react'
import type { InputField, InputFieldType } from '../../services/agent.service'

const TYPE_LABELS: Record<InputFieldType, string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  select: '单选',
  image: '图片上传',
}

interface Props {
  value: InputField[]
  onChange: (v: InputField[]) => void
  /** 可选类型集合（Skill 不需要 image 时可裁剪；默认全类型） */
  allowedTypes?: InputFieldType[]
}

export default function InputFieldsEditor({ value, onChange, allowedTypes }: Props) {
  const types = allowedTypes && allowedTypes.length
    ? allowedTypes
    : (Object.keys(TYPE_LABELS) as InputFieldType[])

  const update = (i: number, patch: Partial<InputField>) =>
    onChange(value.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  const add = () =>
    onChange([
      ...value,
      { key: `field_${value.length + 1}`, label: '', type: types[0], required: false },
    ])

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= value.length) return
    const next = [...value]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-xs text-gray-500">暂无字段。运行时会提供哪些输入由此定义（如「风格描述」「参考图」）。</p>
      )}

      {value.map((f, i) => (
        <div key={i} className="rounded-lg border border-gray-800/60 bg-white/5 p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex flex-col text-gray-600">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                className="hover:text-gray-300 disabled:opacity-30 leading-none" title="上移">
                <GripVertical className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              className="input flex-1 !py-1 text-xs font-mono"
              value={f.key}
              onChange={(e) => update(i, { key: e.target.value.trim() })}
              placeholder="key（英文，如 style_desc）"
            />
            <input
              className="input flex-1 !py-1 text-xs"
              value={f.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="标签（如 风格描述）"
            />
            <select
              className="input !py-1 text-xs w-28"
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as InputFieldType })}
            >
              {types.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
              <input type="checkbox" checked={!!f.required}
                onChange={(e) => update(i, { required: e.target.checked })} />
              必填
            </label>
            <button type="button" onClick={() => remove(i)}
              className="p-1 text-gray-500 hover:text-red-400" title="删除">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {f.type !== 'image' && (
            <input
              className="input !py-1 text-xs"
              value={f.placeholder || ''}
              onChange={(e) => update(i, { placeholder: e.target.value })}
              placeholder="占位/提示文字（可选）"
            />
          )}

          {f.type === 'select' && (
            <input
              className="input !py-1 text-xs"
              value={(f.options || []).join(', ')}
              onChange={(e) =>
                update(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
              }
              placeholder="候选项，逗号分隔（如 16:9, 9:16, 1:1）"
            />
          )}
        </div>
      ))}

      <button type="button" onClick={add}
        className="flex items-center gap-1 text-xs text-pink-300 hover:text-pink-200">
        <Plus className="w-4 h-4" />添加字段
      </button>
    </div>
  )
}
