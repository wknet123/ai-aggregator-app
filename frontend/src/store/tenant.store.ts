import { create } from 'zustand'
import type { Tenant } from '../types/tenant.types'

interface TenantState {
  tenant: Tenant | null
  setTenant: (tenant: Tenant) => void
}

export const useTenantStore = create<TenantState>((set) => ({
  tenant: null,
  setTenant: (tenant: Tenant) => {
    set({ tenant })
  },
}))
