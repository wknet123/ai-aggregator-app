/**
 * Tenant Types
 */

export interface Tenant {
  id: number
  name: string
  slug: string
  is_active: boolean
  max_users: number
  created_at: string
  updated_at: string
}
