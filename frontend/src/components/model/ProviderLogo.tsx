import { getProviderLogo } from '../../config/providerLogos'

interface ProviderLogoProps {
  /** provider 名（如 'Wan'）或 modelId（如 'wan2.7-image'） */
  provider?: string | null
  /** 徽标边长（px） */
  size?: number
  /** 圆角半径（px），默认按 size 比例 */
  radius?: number
  className?: string
}

/**
 * 统一的模型/提供商徽标。取代此前散落的字符字形（万/螺/马）。
 * 未知 provider 自动回退到 generic 徽标。
 */
export default function ProviderLogo({
  provider,
  size = 22,
  radius,
  className = '',
}: ProviderLogoProps) {
  const meta = getProviderLogo(provider)
  return (
    <img
      src={meta.logo}
      alt={meta.label}
      title={meta.label}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className={`inline-block flex-shrink-0 object-contain select-none ${className}`}
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.28) }}
    />
  )
}
