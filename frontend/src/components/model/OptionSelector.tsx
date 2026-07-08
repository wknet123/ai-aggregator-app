import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Ratio, Clock, Monitor, Settings, Layers } from 'lucide-react'

interface OptionSelectorProps {
  optionKey: string
  label: string
  value: any
  options: Array<{ value: any; label: string; priceFactor?: number }>
  onChange: (value: any) => void
  disabled?: boolean
  type?: 'aspect_ratio' | 'number' | 'resolution' | 'quality' | 'default'
}

// Aspect ratio visual representations
const ASPECT_RATIO_VISUALS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 24, height: 24 },
  '4:3': { width: 28, height: 21 },
  '3:4': { width: 21, height: 28 },
  '16:9': { width: 32, height: 18 },
  '9:16': { width: 18, height: 32 },
  '3:2': { width: 30, height: 20 },
  '2:3': { width: 20, height: 30 },
}

// Get icon for option type
const getOptionIcon = (key: string) => {
  switch (key) {
    case 'aspect_ratio':
      return <Ratio className="w-3.5 h-3.5" />
    case 'duration':
      return <Clock className="w-3.5 h-3.5" />
    case 'resolution':
      return <Monitor className="w-3.5 h-3.5" />
    case 'quality':
      return <Settings className="w-3.5 h-3.5" />
    case 'n':
    case 'count':
      return <Layers className="w-3.5 h-3.5" />
    default:
      return <Settings className="w-3.5 h-3.5" />
  }
}

// Determine option type from key
const getOptionType = (key: string): OptionSelectorProps['type'] => {
  if (key === 'aspect_ratio') return 'aspect_ratio'
  if (key === 'resolution') return 'resolution'
  if (key === 'quality') return 'quality'
  if (key === 'n' || key === 'count' || key === 'duration') return 'number'
  return 'default'
}

export default function OptionSelector({
  optionKey,
  label,
  value,
  options,
  onChange,
  disabled = false,
  type,
}: OptionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const resolvedType = type || getOptionType(optionKey)
  const selectedOption = options.find(opt => opt.value === value)

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

  const handleSelect = (newValue: any) => {
    onChange(newValue)
    setIsOpen(false)
  }

  // Render aspect ratio visual
  const renderAspectRatioIcon = (ratioValue: string, isActive: boolean) => {
    const visual = ASPECT_RATIO_VISUALS[ratioValue] || { width: 24, height: 24 }
    const scale = 0.8
    const cls = isActive 
      ? 'border-pink-500 bg-pink-500/20' 
      : 'border-gray-500 bg-transparent hover:border-gray-400'
    return (
      <div 
        className={"border-2 rounded-sm transition-colors " + cls}
        style={{ 
          width: visual.width * scale, 
          height: visual.height * scale,
        }}
      />
    )
  }

  const getTriggerClass = () => {
    let cls = "flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 py-1.5 md:py-2 rounded-lg bg-[#252530] hover:bg-[#2a2a35] border border-gray-700/50 transition-all duration-200"
    if (disabled) cls += " opacity-50 cursor-not-allowed"
    else cls += " cursor-pointer"
    if (isOpen) cls += " border-pink-500/50 bg-[#2a2a35]"
    return cls
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={getTriggerClass()}
      >
        <span className="text-gray-400">{getOptionIcon(optionKey)}</span>
        <span className="text-xs md:text-sm text-gray-200">
          {selectedOption?.label || value}
        </span>
        <ChevronDown className={"w-3.5 h-3.5 text-gray-400 transition-transform " + (isOpen ? "rotate-180" : "")} />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-[#1a1a1f] rounded-xl border border-gray-800/50 shadow-2xl shadow-black/50 overflow-hidden min-w-[200px]">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-800/50">
            <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
          </div>

          {/* Options */}
          <div className="p-3">
            {resolvedType === 'aspect_ratio' && (
              <div className="grid grid-cols-4 gap-2">
                {options.map((opt) => {
                  const isActive = opt.value === value
                  const cls = isActive 
                    ? 'bg-gradient-to-br from-pink-500/20 to-purple-500/20 ring-1 ring-pink-500/50' 
                    : 'bg-[#252530] hover:bg-[#2a2a35]'
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleSelect(opt.value)}
                      className={"flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-lg transition-all duration-150 " + cls}
                    >
                      {renderAspectRatioIcon(opt.value, isActive)}
                      <span className={"text-xs " + (isActive ? "text-pink-400" : "text-gray-400")}>
                        {opt.value}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {(resolvedType === 'number' || resolvedType === 'resolution') && (
              <div className="flex gap-1 bg-[#16161a] p-1 rounded-lg">
                {options.map((opt) => {
                  const isActive = opt.value === value
                  const cls = isActive 
                    ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white shadow-lg shadow-pink-500/20' 
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#252530]'
                  const displayLabel = String(opt.label).split('(')[0].split('-')[0].trim()
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleSelect(opt.value)}
                      className={"flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all duration-150 " + cls}
                    >
                      {displayLabel}
                    </button>
                  )
                })}
              </div>
            )}
            {resolvedType !== 'aspect_ratio' && resolvedType !== 'number' && resolvedType !== 'resolution' && (
              <div className="space-y-1">
                {options.map((opt) => {
                  const isActive = opt.value === value
                  const cls = isActive 
                    ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-400' 
                    : 'text-gray-300 hover:bg-[#252530]'
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleSelect(opt.value)}
                      className={"w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all duration-150 " + cls}
                    >
                      <span className="text-sm">{opt.label}</span>
                      {isActive && (
                        <div className="w-2 h-2 rounded-full bg-pink-500" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
