/**
 * Admin Gateway 配置类型
 */

export interface GatewayConfig {
  id: number
  name: string
  base_url: string
  api_key_masked: string
  is_default: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface GatewayConfigCreate {
  name: string
  base_url: string
  api_key: string
  is_default?: boolean
  is_active?: boolean
}

export interface GatewayConfigUpdate {
  name?: string
  base_url?: string
  api_key?: string
  is_active?: boolean
}

export interface UserMapping {
  user_id: number
  email: string
  username: string
  is_admin: boolean
  gateway_config_id: number | null
}
