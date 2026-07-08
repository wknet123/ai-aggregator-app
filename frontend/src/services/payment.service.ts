/**
 * Payment Service - 支付服务
 */
import axios from 'axios';
import type { CreditPackage, PaymentOrder, CreateOrderRequest, QueryOrderResponse } from '../types/payment.types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

class PaymentService {
  /**
   * 获取积分套餐列表
   */
  async getPackages(): Promise<CreditPackage[]> {
    const token = localStorage.getItem('access_token');
    const response = await axios.get(`${API_BASE_URL}/api/v1/payment/packages`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  }

  /**
   * 创建支付订单
   */
  async createOrder(request: CreateOrderRequest): Promise<PaymentOrder> {
    const token = localStorage.getItem('access_token');
    const response = await axios.post(
      `${API_BASE_URL}/api/v1/payment/orders`,
      request,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.data;
  }

  /**
   * 查询订单状态
   */
  async queryOrder(orderNo: string): Promise<QueryOrderResponse> {
    const token = localStorage.getItem('access_token');
    const response = await axios.get(
      `${API_BASE_URL}/api/v1/payment/orders/${orderNo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.data;
  }

  /**
   * 获取用户订单列表
   */
  async getUserOrders(limit: number = 20): Promise<PaymentOrder[]> {
    const token = localStorage.getItem('access_token');
    const response = await axios.get(
      `${API_BASE_URL}/api/v1/payment/orders?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return response.data;
  }
}

export const paymentService = new PaymentService();
