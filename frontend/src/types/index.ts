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
