import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, LoginResponse } from '../types/auth.types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  hydrated: boolean
  setAuth: (data: LoginResponse) => void
  setUser: (user: User) => void
  logout: () => void
  setHydrated: (hydrated: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      hydrated: false,

      setAuth: (data: LoginResponse) => {
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        localStorage.setItem('tenant_id', data.user.tenant_id.toString())
        
        set({
          user: data.user,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          isAuthenticated: true,
        })
      },

      setUser: (user: User) => {
        set({ user })
      },

      logout: () => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('tenant_id')
        
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        })
      },

      setHydrated: (hydrated: boolean) => {
        set({ hydrated })
      },
    }),
    {
      name: 'auth-storage',
      onRehydrateStorage: () => (state) => {
        // 在状态恢复后，检查 localStorage 中的 token 是否存在
        const token = localStorage.getItem('access_token')
        if (token && state && state.user) {
          // 有 token 且有用户信息，设置为已认证
          state.isAuthenticated = true
          state.accessToken = token
        } else {
          // 没有 token 或没有用户信息，清除认证状态  
          state.user = null
          state.accessToken = null
          state.refreshToken = null
          state.isAuthenticated = false
        }
        // 标记为已完成状态恢复
        state.hydrated = true
      }
    }
  )
)
