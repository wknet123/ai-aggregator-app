/**
 * Workflow Types
 */

export type WorkflowStatus = 'DRAFT' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';

export type StepType = 'TEXT_TO_IMAGE' | 'IMAGE_TO_VIDEO' | 'VIDEO_TO_3D';

export type StepStatus = 
  | 'PENDING' 
  | 'PROCESSING' 
  | 'AWAITING_CONFIRMATION' 
  | 'COMPLETED' 
  | 'FAILED';

export interface WorkflowStepResponse {
  id: number;
  workflow_id: number;
  step_index: number;
  step_type: StepType;
  status: StepStatus;
  model_id: string;
  input_data?: Record<string, any>;
  output_data?: Record<string, any>;
  is_optional: boolean;
  cost: string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
}

export interface WorkflowResponse {
  id: number;
  tenant_id: number;
  user_id: number;
  name: string;
  description?: string;
  status: WorkflowStatus;
  current_step_index: number;
  total_cost: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  steps: WorkflowStepResponse[];
}

export interface WorkflowStepCreate {
  step_type: StepType;
  model_id: string;
  is_optional?: boolean;
  input_data?: Record<string, any>;
}

export interface WorkflowCreate {
  name: string;
  description?: string;
  steps: WorkflowStepCreate[];
}

export interface ExecuteStepRequest {
  input_data: Record<string, any>;
}

export interface ConfirmStepRequest {
  confirmed: boolean;
  feedback?: string;
}
