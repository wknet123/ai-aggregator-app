import { apiClient } from './api'
import type { LoginRequest, RegisterRequest, LoginResponse, User, CaptchaData, ChangePasswordRequest } from '../types/auth.types'

interface ApiResponse<T> {
  success: boolean
  message: string
  data: T
}

export const authService = {
  async getCaptcha(): Promise<CaptchaData> {
    const response = await apiClient.get<ApiResponse<CaptchaData>>('/api/v1/auth/captcha')
    return response.data.data
  },

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const formData = new URLSearchParams()
    formData.append('username', credentials.username)
    formData.append('password', credentials.password)
    if (credentials.captcha_token) formData.append('captcha_token', credentials.captcha_token)
    if (credentials.captcha_answer) formData.append('captcha_answer', credentials.captcha_answer)

    const response = await apiClient.post<ApiResponse<LoginResponse>>(
      '/api/v1/auth/login',
      formData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )
    return response.data.data
  },

  async register(data: RegisterRequest): Promise<User> {
    const response = await apiClient.post<ApiResponse<User>>(
      '/api/v1/auth/register',
      data
    )
    return response.data.data
  },

  async getCurrentUser(): Promise<User> {
    const response = await apiClient.get<ApiResponse<User>>('/api/v1/users/me')
    return response.data.data
  },

  async updateProfile(data: { full_name?: string }): Promise<User> {
    const response = await apiClient.put<ApiResponse<User>>('/api/v1/users/me', data)
    return response.data.data
  },

  async changePassword(data: ChangePasswordRequest): Promise<void> {
    await apiClient.post('/api/v1/users/me/change-password', data)
  },

  async refreshToken(refreshToken: string): Promise<{ access_token: string }> {
    const response = await apiClient.post<ApiResponse<{ access_token: string }>>(
      '/api/v1/auth/refresh',
      { refresh_token: refreshToken }
    )
    return response.data.data
  },
}
