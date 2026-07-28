/** Agent Trace Viewer 类型定义 */

export interface Session {
  id: string;
  agent: 'claude-code' | 'codex';
  project_path: string | null;
  title: string | null;
  started_at: number | null;
  finished_at: number | null;
  status: 'active' | 'completed';
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  file_path: string;
}

export interface Turn {
  id?: number;
  session_id: string;
  turn_index: number;
  user_message: string | null;
  started_at: number | null;
  finished_at: number | null;
  input_tokens: number;
  output_tokens: number;
  steps: Step[];
}

export interface ContentBlock {
  type: string; // thinking | tool_use | text | tool_result | image
  thinking?: string;
  text?: string;
  name?: string; // tool name for tool_use
  input?: unknown; // tool input for tool_use
  id?: string; // tool_use id
  tool_use_id?: string; // for tool_result
  content?: unknown; // for tool_result
  is_error?: boolean;
  source?: { type: string; media_type: string; data: string }; // for image
}

export interface Step {
  id: number;
  session_id: string;
  turn_id: number | null;
  step_index: number;
  type: string; // assistant | user | system | attachment
  role: string; // assistant | user
  timestamp: number | null;
  duration_ms: number | null;
  tool_name: string | null;
  model: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_use_id: string | null;
  content: string | null;
  content_blocks: ContentBlock[];
  description: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
}

export interface Stats {
  total_steps: number;
  total_turns: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_duration_ms: number;
  tool_counts: Record<string, number>;
  type_counts: Record<string, number>;
}

export interface FileChange {
  session_id: string;
  message_id: string;
  step_index: number | null;
  tracking_path: string | null;
  backup_file_name: string | null;
  version: number | null;
  backup_time: string | null;
  timestamp: number | null;
  is_new_file: boolean;
}

export interface FileChangeDiff {
  session_id: string;
  message_id: string;
  tracking_path: string | null;
  is_new_file: boolean;
  diff: string;
}

export interface TodoEvent {
  event_type: 'created' | 'status_changed';
  step_index: number | null;
  timestamp: number | null;
  old_status?: string;
  status: string;
}

export interface TodoTask {
  session_id: string;
  task_id: string;
  subject: string;
  description: string;
  active_form: string;
  created_step_index: number | null;
  created_timestamp: number | null;
  final_status: string;
  events: TodoEvent[];
}

export interface CostTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
}

export interface CostPricing {
  tier: string;
  tiers_used: string[];
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_creation_per_mtok: number;
  note: string;
}

export interface CostPerTurn {
  turn_index: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  estimated_cost_usd: number;
}

export interface CostPerTool {
  tool_name: string;
  count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  estimated_cost_usd: number;
}

export interface CacheEfficiency {
  fresh_input_ratio: number;
  cache_read_ratio: number;
  cache_creation_ratio: number;
  output_ratio: number;
}

export interface SubagentSummary {
  session_id: string;
  agent_id: string;
  agent_type: string | null;
  description: string | null;
  tool_use_id: string | null;
  spawn_depth: number;
  step_index: number | null;
  has_trace: boolean;
}

export interface SubagentTrace {
  session_id: string;
  tool_use_id: string;
  agent_id: string;
  agent_type: string | null;
  description: string | null;
  turns: Turn[];
}

export interface CostAnalysis {
  session_id: string;
  totals: CostTotals;
  pricing: CostPricing;
  per_turn: CostPerTurn[];
  per_tool: CostPerTool[];
  cache_efficiency: CacheEfficiency;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface WSStepEvent {
  event: 'step';
  session_id: string;
  step: Step;
}

export interface WSSessionStatusEvent {
  event: 'session_status';
  session_id: string;
  status: string;
}

export interface WSNewSessionEvent {
  event: 'new_session';
  session: Session;
}

export type WSEvent = WSStepEvent | WSSessionStatusEvent | WSNewSessionEvent;

// Knowledge types
export interface KnowledgeItem {
  id: string;
  project_path: string;
  type: string;
  content: string;
  title?: string;
  confidence: number;
  status: string;
  source_sessions: string[];
  source_turns: Array<{
    session_id: string;
    turn_index: number;
    description?: string;
  }>;
  write_level: string;
  is_modified: boolean;
  created_at: string;
  approved_at?: string;
  synced_at?: string;
  synced_path?: string;
}

export interface KnowledgeProject {
  path: string;
  total_items: number;
  pending_items: number;
  synced_items: number;
}

export interface KnowledgeStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  project_level: number;
  user_level: number;
}
