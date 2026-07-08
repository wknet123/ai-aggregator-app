/**
 * Workflow Service
 */
import { apiClient } from './api';
import type { 
  WorkflowCreate, 
  WorkflowResponse, 
  WorkflowStepResponse,
  ExecuteStepRequest,
  ConfirmStepRequest
} from '../types/workflow.types';

class WorkflowService {
  /**
   * Create new workflow
   */
  async createWorkflow(data: WorkflowCreate): Promise<WorkflowResponse> {
    const response = await apiClient.post('/api/v1/workflows/', data);
    return response.data.data;
  }

  /**
   * List all workflows
   */
  async listWorkflows(skip: number = 0, limit: number = 100): Promise<WorkflowResponse[]> {
    const response = await apiClient.get(`/api/v1/workflows/?skip=${skip}&limit=${limit}`);
    return response.data.data;
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(workflowId: number): Promise<WorkflowResponse> {
    const response = await apiClient.get(`/api/v1/workflows/${workflowId}`);
    return response.data.data;
  }

  /**
   * Execute workflow step
   */
  async executeStep(
    workflowId: number,
    stepIndex: number,
    inputData: Record<string, any>,
    modelId?: string
  ): Promise<WorkflowStepResponse> {
    const payload: any = { input_data: inputData };
    if (modelId) {
      payload.model_id = modelId;
    }
    const response = await apiClient.post(
      `/api/v1/workflows/${workflowId}/steps/${stepIndex}/execute`,
      payload
    );
    return response.data.data;
  }

  /**
   * Confirm step completion
   */
  async confirmStep(
    workflowId: number,
    stepIndex: number,
    confirmed: boolean,
    feedback?: string
  ): Promise<WorkflowResponse> {
    const response = await apiClient.post(
      `/api/v1/workflows/${workflowId}/steps/${stepIndex}/confirm`,
      { confirmed, feedback } as ConfirmStepRequest
    );
    return response.data.data;
  }

  /**
   * Delete workflow
   */
  async deleteWorkflow(workflowId: number): Promise<void> {
    await apiClient.delete(`/api/v1/workflows/${workflowId}`);
  }
}

export const workflowService = new WorkflowService();
