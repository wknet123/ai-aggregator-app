import { useEffect, useState } from 'react'
import type { ModelConfig, ModelCategory } from '../../types/model.types'
import { getModelsByCategory, getModelById } from '../../config/models.config'
import ModelSelector from './ModelSelector'
import OptionSelector from './OptionSelector'

interface CompactConfigBarProps {
  category: ModelCategory
  selectedModelId: string
  onModelChange: (modelId: string) => void
  config: Record<string, any>
  onConfigChange: (config: Record<string, any>) => void
  disabled?: boolean
}

export default function CompactConfigBar({
  category,
  selectedModelId,
  onModelChange,
  config,
  onConfigChange,
  disabled = false,
}: CompactConfigBarProps) {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [model, setModel] = useState<ModelConfig | null>(null)

  useEffect(() => {
    const categoryModels = getModelsByCategory(category)
    // Sort: enabled first
    const sorted = [...categoryModels].sort((a, b) => {
      if (a.enabled === b.enabled) return 0
      return a.enabled ? -1 : 1
    })
    setModels(sorted)

    // Auto-select first enabled model
    const enabledModels = sorted.filter(m => m.enabled !== false)
    const currentModel = sorted.find(m => m.id === selectedModelId)
    if (!selectedModelId || !currentModel || currentModel.enabled === false) {
      if (enabledModels.length > 0) {
        onModelChange(enabledModels[0].id)
      }
    }
  }, [category])

  useEffect(() => {
    const foundModel = getModelById(selectedModelId)
    setModel(foundModel || null)

    // Initialize config with default values
    if (foundModel) {
      const defaultConfig: Record<string, any> = {}
      foundModel.options.forEach((option) => {
        if (config[option.key] === undefined) {
          defaultConfig[option.key] = option.default
        }
      })
      if (Object.keys(defaultConfig).length > 0) {
        onConfigChange({ ...config, ...defaultConfig })
      }
    }
  }, [selectedModelId])

  const handleOptionChange = (key: string, value: any) => {
    onConfigChange({ ...config, [key]: value })
  }

  return (
    <div className="flex items-center gap-2 md:gap-3 flex-wrap">
      {/* Model Selector - New Two-Column Dropdown */}
      <ModelSelector
        category={category}
        selectedModelId={selectedModelId}
        onModelChange={onModelChange}
        disabled={disabled}
      />

      {/* Divider */}
      <div className="config-divider" />

      {/* Model Options - Using OptionSelector */}
      {model?.options.filter(opt => opt.type === 'select' && opt.options).map((option, idx) => {
        const value = config[option.key] ?? option.default
        return (
          <div key={option.key} className="flex items-center gap-2">
            <OptionSelector
              optionKey={option.key}
              label={option.label}
              value={value}
              options={option.options || []}
              onChange={(newValue) => {
                const finalValue = typeof option.default === 'number'
                  ? Number(newValue)
                  : newValue
                handleOptionChange(option.key, finalValue)
              }}
              disabled={disabled}
            />
            {idx < (model?.options.filter(opt => opt.type === 'select' && opt.options).length || 0) - 1 && (
              <div className="config-divider hidden md:block" />
            )}
          </div>
        )
      })}
    </div>
  )
}
