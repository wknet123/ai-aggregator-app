import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Clock, Gem } from 'lucide-react'
import type { ModelConfig, ModelCategory } from '../../types/model.types'
import { getModelsByCategory, getModelById } from '../../config/models.config'
import { getProviderLogo } from '../../config/providerLogos'
import ProviderLogo from './ProviderLogo'

interface ModelSelectorProps {
  category: ModelCategory
  selectedModelId: string
  onModelChange: (modelId: string) => void
  disabled?: boolean
}

// Estimated generation time for models (in seconds)
const MODEL_TIME_ESTIMATE: Record<string, number> = {
  'wan2.7-image': 15,
  'wan2.7-image-pro': 25,
  'hailuo': 120,
  'happyhorse': 100,
}

export default function ModelSelector({
  category,
  selectedModelId,
  onModelChange,
  disabled = false,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Get models for current category
  const models = getModelsByCategory(category)
  const selectedModel = getModelById(selectedModelId)

  // Get unique providers
  const providers = [...new Set(models.map(m => m.provider))]

  // Get models for selected provider
  const providerModels = selectedProvider
    ? models.filter(m => m.provider === selectedProvider)
    : []

  // Auto-select first provider when dropdown opens
  useEffect(() => {
    if (isOpen && !selectedProvider && providers.length > 0) {
      // Select the provider of current model, or first provider
      const currentProvider = selectedModel?.provider || providers[0]
      setSelectedProvider(currentProvider)
    }
  }, [isOpen, providers, selectedModel, selectedProvider])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId)
    setIsOpen(false)
  }

  const formatTime = (seconds: number) => {
    if (seconds >= 60) {
      const mins = Math.floor(seconds / 60)
      return `${mins}分钟`
    }
    return `${seconds}秒`
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg
          bg-[#252530] hover:bg-[#2a2a35] border border-gray-700/50
          transition-all duration-200
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isOpen ? 'border-pink-500/50 bg-[#2a2a35]' : ''}
        `}
      >
        {/* Provider Logo */}
        <ProviderLogo provider={selectedModel?.provider || selectedModel?.id} size={20} />

        {/* Model Name */}
        <span className="text-sm text-gray-200 max-w-[120px] md:max-w-[160px] truncate">
          {selectedModel?.name || '选择模型'}
        </span>

        {/* Dropdown Arrow */}
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 flex flex-col md:flex-row bg-[#1a1a1f] rounded-xl border border-gray-800/50 shadow-2xl shadow-black/50 overflow-hidden w-[calc(100vw-2rem)] max-w-[320px] md:max-w-[480px] md:w-auto md:min-w-[480px]">
          {/* Left Column - Providers */}
          <div className="w-full md:w-[160px] bg-[#16161a] border-b md:border-b-0 md:border-r border-gray-800/50 py-2">
            <div className="px-3 py-2 text-xs text-gray-500 uppercase tracking-wider">
              模型提供商
            </div>
            {providers.map((provider) => {
              const meta = getProviderLogo(provider)
              const providerModelsList = models.filter(m => m.provider === provider)
              const hasEnabledModels = providerModelsList.some(m => m.enabled !== false)

              return (
                <button
                  key={provider}
                  onClick={() => setSelectedProvider(provider)}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2.5 text-left
                    transition-all duration-150
                    ${selectedProvider === provider
                      ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 border-l-2 border-pink-500'
                      : 'hover:bg-white/5 border-l-2 border-transparent'
                    }
                    ${!hasEnabledModels ? 'opacity-50' : ''}
                  `}
                >
                  <ProviderLogo provider={provider} size={20} />
                  <span className={`text-sm ${selectedProvider === provider ? 'text-white' : 'text-gray-300'}`}>
                    {provider}
                  </span>
                  {meta.isNew && (
                    <span className="ml-auto text-[9px] bg-gradient-to-r from-pink-500 to-purple-500 text-white px-1.5 py-0.5 rounded-full">
                      New
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Right Column - Models */}
          <div className="flex-1 py-2 max-h-[240px] md:max-h-[320px] overflow-y-auto">
            <div className="px-3 py-1.5 md:py-2 text-[10px] md:text-xs text-gray-500 uppercase tracking-wider">
              可用模型
            </div>
            {providerModels.length === 0 ? (
              <div className="px-3 py-3 md:py-4 text-xs md:text-sm text-gray-500 text-center">
                选择提供商查看模型
              </div>
            ) : (
              providerModels.map((model) => {
                const isSelected = model.id === selectedModelId
                const timeEstimate = MODEL_TIME_ESTIMATE[model.id] || 30
                const isDisabled = model.enabled === false

                return (
                  <button
                    key={model.id}
                    onClick={() => !isDisabled && handleModelSelect(model.id)}
                    disabled={isDisabled}
                    className={`
                      w-full px-3 py-3 text-left transition-all duration-150
                      ${isSelected
                        ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20'
                        : 'hover:bg-white/5'
                      }
                      ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                  >
                    <div className="flex items-start gap-3">
                      {/* Model Logo */}
                      <div className={`
                        w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 p-1
                        ${isSelected
                          ? 'ring-2 ring-pink-500/60'
                          : 'bg-[#252530]'
                        }
                      `}>
                        <ProviderLogo provider={model.provider || model.id} size={24} />
                      </div>

                      {/* Model Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${isSelected ? 'text-pink-400' : 'text-gray-200'}`}>
                            {model.name}
                          </span>
                          {isDisabled && (
                            <span className="text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">
                              即将上线
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                          {model.description}
                        </p>

                        {/* Meta Info */}
                        <div className="flex items-center gap-3 mt-2">
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="w-3 h-3" />
                            <span>{formatTime(timeEstimate)}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-pink-400">
                            <Gem className="w-3 h-3" />
                            <span>{model.basePrice}+ 积分</span>
                          </div>
                        </div>
                      </div>

                      {/* Selection Indicator */}
                      {isSelected && (
                        <div className="w-2 h-2 rounded-full bg-pink-500 flex-shrink-0 mt-2" />
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
