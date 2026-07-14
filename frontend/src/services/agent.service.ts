/**
 * Agent Service —— 自定义智能体（Custom Agent = SKILL × Plugin）AgentStudio 前端接口层。
 *
 * 覆盖后端 app/api/v1/agents.py 全部端点：Agent/Skill CRUD、Plugin 清单、
 * Run 投递/轮询/取消/人工确认、dry-run、产物鉴权取流（blob）。
 * 全部走 apiClient（自动带 JWT + X-Tenant-ID），返回体统一 { success, data }。
 */
import { apiClient } from './api'

// ── 类型（字段与后端 _agent_out / _skill_out / _run_to_dict / list_plugins 一一对应）──

export interface AgentPolicy {
  max_steps?: number
  budget_limit?: number
  confirm_cost_threshold?: number
  confirm_mode?: 'auto' | 'checkpoint' | 'step'
}

// 声明式「用户输入」字段定义（配置时编排，运行时渲染动态表单）
export type InputFieldType = 'text' | 'textarea' | 'number' | 'select' | 'image'
export interface InputField {
  key: string
  label: string
  type: InputFieldType
  required?: boolean
  placeholder?: string
  help?: string
  options?: string[]        // type=select 时的候选项
}

export interface AgentDef {
  agent_id: string
  name: string
  description?: string | null
  avatar?: string | null
  persona: string
  skill_ids: string[]
  allowed_plugins: string[]
  policy: AgentPolicy
  input_schema: InputField[]
  scope: 'system' | 'tenant' | 'private'
  is_active: number
  created_at?: string | null
  updated_at?: string | null
}

export interface AgentBody {
  name: string
  persona: string
  description?: string | null
  avatar?: string | null
  skill_ids?: string[]
  allowed_plugins?: string[]
  policy?: AgentPolicy
  input_schema?: InputField[]
  scope?: 'private' | 'tenant'
}

export interface SkillDef {
  skill_id: string
  name: string
  category?: string | null
  icon?: string | null
  description?: string | null
  when_to_use?: string | null
  instructions: string
  recommended_plugins: string[]
  inputs: any[]
  outputs: any[]
  constraints: Record<string, any>
  few_shot: any[]
  scope: 'system' | 'tenant' | 'private'
  version: number
  updated_at?: string | null
}

export interface SkillBody {
  name: string
  instructions: string
  category?: string | null
  icon?: string | null
  description?: string | null
  when_to_use?: string | null
  recommended_plugins?: string[]
  inputs?: any[]
  outputs?: any[]
  constraints?: Record<string, any>
  few_shot?: any[]
  scope?: 'private' | 'tenant'
}

export interface PluginSpec {
  name: string
  family: string
  label: string
  description: string
  output_type: string
  parameters_schema: Record<string, any>
}

export interface AgentArtifact {
  type: string          // image | video | audio | text
  key?: string          // MinIO 产物 key（走 artifact 端点取流）
  note?: string
  aspect_ratio?: string
  duration?: number
  [k: string]: any
}

export interface AgentStep {
  step_index: number
  type: string          // plan | tool_call | confirm | summary ...
  plugin_name?: string | null
  thought?: string | null
  input_data?: any
  output_data?: any
  status: string        // completed | skipped | failed | ...
  error_message?: string | null
}

export interface PendingConfirmationItem {
  tool_call_id: string
  name: string
  plugin?: string | null
  label: string
  args: Record<string, any>
  cost: number
}

export interface PendingConfirmation {
  type: string
  mode: 'checkpoint' | 'step'
  pending: PendingConfirmationItem[]
  actions: string[]
  message: string
}

export type RunStatus =
  | 'pending' | 'planning' | 'running'
  | 'awaiting_confirmation' | 'completed' | 'failed' | 'cancelled'

export interface AgentRun {
  run_id: string
  agent_key: string
  goal: string
  status: RunStatus
  progress: number
  confirm_mode?: 'auto' | 'checkpoint' | 'step'
  pending_confirmation?: PendingConfirmation | null
  plan?: any
  final_artifacts?: AgentArtifact[] | null
  total_cost: number
  error_message?: string | null
  created_at?: string | null
  updated_at?: string | null
  steps?: AgentStep[]
}

export interface CreateRunBody {
  goal: string
  inputs?: Record<string, any> | null
  agent_key?: string
  confirm_mode?: 'auto' | 'checkpoint' | 'step'
}

export interface ConfirmBody {
  action: 'continue' | 'edit' | 'skip' | 'abort'
  edited_args?: Record<string, Record<string, any>>   // {tool_call_id: {...新参数...}}
  reason?: string
}

export interface DryRunPlannedTool {
  name: string
  plugin?: string | null
  label: string
  args: Record<string, any>
  cost: number
}

export interface DryRunResult {
  plan_text: string
  planned_tool_calls: DryRunPlannedTool[]
  allowed_plugins: string[]
  estimated_cost: number
}

class AgentService {
  // ── Agent ────────────────────────────────────────────────────────────────
  async listAgents(): Promise<AgentDef[]> {
    const r = await apiClient.get('/api/v1/agents/')
    return r.data.data.items
  }
  async getAgent(agentId: string): Promise<AgentDef> {
    const r = await apiClient.get(`/api/v1/agents/${agentId}`)
    return r.data.data
  }
  async createAgent(body: AgentBody): Promise<AgentDef> {
    const r = await apiClient.post('/api/v1/agents/', body)
    return r.data.data
  }
  async updateAgent(agentId: string, body: AgentBody): Promise<AgentDef> {
    const r = await apiClient.put(`/api/v1/agents/${agentId}`, body)
    return r.data.data
  }
  async deleteAgent(agentId: string): Promise<void> {
    await apiClient.delete(`/api/v1/agents/${agentId}`)
  }

  // ── Skill ────────────────────────────────────────────────────────────────
  async listSkills(): Promise<SkillDef[]> {
    const r = await apiClient.get('/api/v1/agents/skills')
    return r.data.data.items
  }
  async createSkill(body: SkillBody): Promise<SkillDef> {
    const r = await apiClient.post('/api/v1/agents/skills', body)
    return r.data.data
  }
  async updateSkill(skillId: string, body: SkillBody): Promise<SkillDef> {
    const r = await apiClient.put(`/api/v1/agents/skills/${skillId}`, body)
    return r.data.data
  }
  async deleteSkill(skillId: string): Promise<void> {
    await apiClient.delete(`/api/v1/agents/skills/${skillId}`)
  }

  // ── Plugin ───────────────────────────────────────────────────────────────
  async listPlugins(): Promise<PluginSpec[]> {
    const r = await apiClient.get('/api/v1/agents/plugins')
    return r.data.data.items
  }

  // ── Run ──────────────────────────────────────────────────────────────────
  async createRun(body: CreateRunBody): Promise<{ run_id: string }> {
    const r = await apiClient.post('/api/v1/agents/runs', body)
    return r.data.data
  }
  async getRun(runId: string): Promise<AgentRun> {
    const r = await apiClient.get(`/api/v1/agents/runs/${runId}`)
    return r.data.data
  }
  async listRuns(): Promise<AgentRun[]> {
    const r = await apiClient.get('/api/v1/agents/runs')
    return r.data.data.items
  }
  async cancelRun(runId: string): Promise<{ status: string }> {
    const r = await apiClient.post(`/api/v1/agents/runs/${runId}/cancel`)
    return r.data.data
  }
  async confirmRun(runId: string, body: ConfirmBody): Promise<{ action: string; status: string }> {
    const r = await apiClient.post(`/api/v1/agents/runs/${runId}/confirm`, body)
    return r.data.data
  }
  async dryRun(body: CreateRunBody): Promise<DryRunResult> {
    const r = await apiClient.post('/api/v1/agents/dry-run', {
      goal: body.goal, inputs: body.inputs, agent_key: body.agent_key,
    })
    return r.data.data
  }

  // ── 产物取流（鉴权 blob → objectURL；调用方负责 revokeObjectURL）─────────────
  async artifactObjectUrl(runId: string, key: string): Promise<string> {
    const r = await apiClient.get(`/api/v1/agents/runs/${runId}/artifact`, {
      params: { key },
      responseType: 'blob',
    })
    return URL.createObjectURL(r.data as Blob)
  }

  // ── Run 输入素材上传（图片 → MinIO，返回 key 填入 inputs）─────────────────────
  async uploadRunInput(file: File): Promise<{ key: string; content_type: string }> {
    const form = new FormData()
    form.append('file', file)
    const r = await apiClient.post('/api/v1/agents/uploads', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return r.data.data
  }

  // ── 上传素材鉴权预览（blob → objectURL；调用方负责 revokeObjectURL）───────────
  async uploadFileObjectUrl(key: string): Promise<string> {
    const r = await apiClient.get('/api/v1/agents/uploads/file', {
      params: { key },
      responseType: 'blob',
    })
    return URL.createObjectURL(r.data as Blob)
  }
}

export const agentService = new AgentService()
