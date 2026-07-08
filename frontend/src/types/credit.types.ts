/**
 * Credit Types
 */

export interface Credit {
  id: number
  balance: number | string
  total_recharged: number | string
  total_consumed: number | string
  tenant_id: number
  created_at: string
  updated_at: string
}

export interface Transaction {
  id: number
  type: 'recharge' | 'consumption' | 'refund' | 'adjustment'
  amount: number | string
  status: 'pending' | 'completed' | 'failed' | 'cancelled'
  description?: string
  reference_id?: string
  tenant_id: number
  created_at: string
  updated_at: string
}

export interface RechargeRequest {
  amount: number
  payment_method: string
  reference_id: string
}
