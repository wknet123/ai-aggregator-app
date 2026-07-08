import axios, { AxiosInstance, AxiosError, AxiosRequestHeaders } from 'axios'

// In production, use empty string (relative paths via nginx proxy)
// In development, use VITE_API_URL or default to localhost:8000
const API_URL = import.meta.env.VITE_API_URL || ''

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('access_token')
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        
        const tenantId = localStorage.getItem('tenant_id')
        if (tenantId) {
          config.headers['X-Tenant-ID'] = tenantId
        }
        
        return config
      },
      (error) => Promise.reject(error)
    )

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const original = error.config as (AxiosError['config'] & { _retry?: boolean }) | undefined

        // On 401, try to silently refresh the access token before giving up.
        // A long-running generation can outlive the 30-min access token; without
        // this the user's next click would 401 and log them out mid-task.
        const isAuthCall = original?.url?.includes('/api/v1/auth/')
        if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
          original._retry = true
          const newToken = await this.refreshAccessToken()
          if (newToken) {
            original.headers = (original.headers ?? {}) as AxiosRequestHeaders
            original.headers.Authorization = `Bearer ${newToken}`
            return this.client(original)
          }
        }

        if (error.response?.status === 401) {
          // Refresh failed (or unavailable): clear auth and redirect to login.
          await this.forceLogout()
        }
        return Promise.reject(error)
      }
    )
  }

  // Single-flight token refresh: concurrent 401s share one in-flight request so
  // we don't fire N refreshes (or N logouts) when several calls expire together.
  private refreshPromise: Promise<string | null> | null = null

  private refreshAccessToken(): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise

    const refreshToken = localStorage.getItem('refresh_token')
    if (!refreshToken) return Promise.resolve(null)

    this.refreshPromise = axios
      // Bare axios (not this.client) so the request interceptor doesn't attach the
      // stale access token and the response interceptor can't recurse on a 401.
      .post(`${API_URL}/api/v1/auth/refresh`, { refresh_token: refreshToken })
      .then((resp) => {
        const newToken = resp.data?.data?.access_token as string | undefined
        if (newToken) {
          localStorage.setItem('access_token', newToken)
          return newToken
        }
        return null
      })
      .catch(() => null)
      .finally(() => {
        this.refreshPromise = null
      })

    return this.refreshPromise
  }

  private async forceLogout() {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('tenant_id')

    const { useAuthStore } = await import('../store/auth.store')
    useAuthStore.getState().logout()

    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login'
    }
  }

  getInstance(): AxiosInstance {
    return this.client
  }
}

export const apiClient = new ApiClient().getInstance()
