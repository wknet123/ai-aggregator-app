/**
 * Payment Types - 支付相关类型定义
 */

export interface CreditPackage {
  id: number;
  name: string;
  description?: string;
  credits: number;
  price: number;
  original_price?: number;
  badge?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentOrder {
  id: number;
  order_no: string;
  package_name: string;
  credits: number;
  amount: number;
  payment_method: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  qr_code?: string;
  trade_no?: string;
  created_at: string;
  paid_at?: string;
  expired_at?: string;
  error_message?: string;
}

export interface CreateOrderRequest {
  package_id: number;
  payment_method: string;
}

export interface QueryOrderResponse {
  order: PaymentOrder;
  is_expired: boolean;
}
