/** Types for the NanoCore Agent Terminal. */

export type FeedItemType =
  | 'user'
  | 'ai_text'
  | 'thinking'
  | 'step_label'
  | 'tool_start'
  | 'tool_output'
  | 'diff_proposal'
  | 'human_escalation'
  | 'auto_retry'
  | 'error'
  | 'info'

export interface DiffMetadata {
  callId: string
  filePath: string
  oldContent: string
  newContent: string
  diff: string
  status: 'pending' | 'approved' | 'rejected'
  rejectReason?: string
}

export interface ToolMetadata {
  callId: string
  tool: string
  command?: string
  exitCode?: number
}

export interface EscalationMetadata {
  escalationId: string
  reason: string
  status: 'pending' | 'responded'
  userMessage?: string
}

export interface AutoRetryMetadata {
  attempt: number
  maxAttempts: number
  command: string
  status: 'retrying' | 'resolved' | 'exhausted'
}

export interface FeedItem {
  id: string
  type: FeedItemType
  content: string
  timestamp: number
  toolMeta?: ToolMetadata
  diffMeta?: DiffMetadata
  escalationMeta?: EscalationMetadata
  autoRetryMeta?: AutoRetryMetadata
}

export interface TelemetryAction {
  timestamp: number
  action: string
  detail: string
}

export interface TelemetryData {
  agent: string
  state: string
  tokensUsed: number
  elapsedMs: number
  iteration: number
  actions: TelemetryAction[]
  tokenBudget: number
  budgetFraction: number
}

export interface SSEEvent {
  event: string
  data: Record<string, unknown>
}
