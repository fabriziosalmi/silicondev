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
  | 'agency_trace'
  | 'rag_search'
  | 'scout_alert'
  | 'swarm_progress'
  | 'plan_proposal'
  | 'plan_step'

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

export interface AgencyTraceMetadata {
  role: 'architect' | 'worker' | 'inspector'
  content: string
  target?: string
}

export interface RAGSearchMetadata {
  query: string
  results: Array<{
    file_path: string
    score: number
    method: string
  }>
}

export interface ScoutAlertMetadata {
  issues: Array<{
    file: string
    type: 'error' | 'warning'
    message: string
  }>
}

export interface PlanStep {
  file: string
  action: 'modify' | 'create' | 'delete'
  description: string
  status?: 'pending' | 'running' | 'approved' | 'rejected' | 'error'
  editTokens?: number
}

export interface PlanProposalMetadata {
  sessionId: string
  steps: PlanStep[]
  planTokens: number
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'done'
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
  agencyTraceMeta?: AgencyTraceMetadata
  ragSearchMeta?: RAGSearchMetadata
  scoutAlertMeta?: ScoutAlertMetadata
  planMeta?: PlanProposalMetadata
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
