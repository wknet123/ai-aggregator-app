import { apiClient } from './api'

export interface QuickPrompt {
  icon: string
  label: string
  prompt: string
}

interface QuickPromptsResponse {
  prompts: QuickPrompt[]
  source: 'ai' | 'fallback'
}

export async function getQuickPrompts(
  category: 'image' | 'video' = 'image',
  refresh: boolean = false
): Promise<QuickPrompt[]> {
  const { data } = await apiClient.get<QuickPromptsResponse>(
    '/api/v1/suggestions/quick-prompts',
    { params: { category, refresh } }
  )
  return data.prompts
}

export async function polishPrompt(
  prompt: string,
  category: 'image' | 'video' | 'drama' | 'skill' | 'agent' = 'image'
): Promise<string> {
  const { data } = await apiClient.post<{ polished: string }>(
    '/api/v1/suggestions/polish-prompt',
    { prompt, category }
  )
  return data.polished
}
