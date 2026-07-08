/**
 * Authentication Types
 */

export interface User {
  id: number
  email: string
  username: string
  full_name?: string
  is_active: boolean
  is_admin: boolean
  tenant_id: number
  created_at: string
  updated_at: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  email: string
  username: string
  password: string
  full_name?: string
  tenant_name?: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  user: User
}

export interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
}
