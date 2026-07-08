import { useEffect, useState } from 'react'
import type { ModelConfig, ModelOption } from '../../types/model.types'
import { getModelById } from '../../config/models.config'

interface ModelConfigPanelProps {
  modelId: string
  config: Record<string, any>
  onConfigChange: (config: Record<string, any>) => void
}

export default function ModelConfigPanel({
  modelId,
  config,
  onConfigChange,
}: ModelConfigPanelProps) {
  const [model, setModel] = useState<ModelConfig | null>(null)

  useEffect(() => {
    const foundModel = getModelById(modelId)
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
  }, [modelId])

  if (!model) {
    return <div className="text-gray-500">Please select a model</div>
  }

  const handleOptionChange = (key: string, value: any) => {
    onConfigChange({ ...config, [key]: value })
  }

  const renderOption = (option: ModelOption) => {
    const value = config[option.key] ?? option.default

    switch (option.type) {
      case 'select':
        return (
          <div key={option.key} className="mb-4">
            <label className="block text-sm font-medium mb-2">
              {option.label}
            </label>
            <select
              className="input"
              value={value}
              onChange={(e) => {
                const newValue =
                  typeof option.default === 'number'
                    ? Number(e.target.value)
                    : e.target.value
                handleOptionChange(option.key, newValue)
              }}
            >
              {option.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                  {opt.priceFactor && opt.priceFactor !== 1
                    ? ` (${opt.priceFactor}x)`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        )

      case 'slider':
        return (
          <div key={option.key} className="mb-4">
            <label className="block text-sm font-medium mb-2">
              {option.label}: {value}
              {option.unit ? ` ${option.unit}` : ''}
            </label>
            <input
              type="range"
              className="w-full"
              min={option.min}
              max={option.max}
              step={option.step}
              value={value}
              onChange={(e) =>
                handleOptionChange(option.key, Number(e.target.value))
              }
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{option.min}</span>
              <span>{option.max}</span>
            </div>
          </div>
        )

      case 'input':
        return (
          <div key={option.key} className="mb-4">
            <label className="block text-sm font-medium mb-2">
              {option.label}
            </label>
            <input
              type="text"
              className="input"
              value={value}
              onChange={(e) => handleOptionChange(option.key, e.target.value)}
            />
          </div>
        )

      case 'toggle':
        return (
          <div key={option.key} className="mb-4 flex items-center">
            <input
              type="checkbox"
              id={option.key}
              className="mr-2"
              checked={value}
              onChange={(e) =>
                handleOptionChange(option.key, e.target.checked)
              }
            />
            <label htmlFor={option.key} className="text-sm font-medium">
              {option.label}
            </label>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-medium text-gray-500">📐 Configuration</h3>
      {model.options.map((option) => renderOption(option))}
    </div>
  )
}
