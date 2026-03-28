/** A message in a dispatch-api chat conversation */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  audio_url: string | null;
  image_url: string | null;
  video_url: string | null;
  created_at: string;
  status?: string; // "generating" | "complete" | "failed"
  failure_reason?: string | null; // "timeout" | "generation_error" | "server_restart" | "storage_error"
}

/** A chat conversation (dispatch-api chats) */
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string | null;
  last_message_role: string | null;
  last_opened_at: string | null;
  has_notes?: boolean;
  is_thinking?: boolean;
  forked_from?: string | null;
  fork_message_id?: string | null;
  marked_unread?: boolean;
  image_url?: string | null; // Cover image URL (generated via nano-banana)
  image_status?: string | null; // "generating" | "ready" | "failed" | null
}

/** Notes for a chat */
export interface ChatNotes {
  chat_id: string;
  content: string;
  updated_at: string | null;
}

/** Response from POST /prompt and POST /prompt-with-image */
export interface PromptResponse {
  status: string;
  message: string;
  request_id: string;
}

/** An agent/contact session from the agents dashboard API */
export interface AgentSession {
  id: string;
  type: "contact" | "dispatch-api";
  name: string;
  tier: string;
  source: string;
  chat_type: string;
  participants: string[] | null;
  last_message: string | null;
  last_message_time: string | null;
  last_message_is_from_me: boolean;
  status: string;
}

/** A message in an agent/contact session */
export interface AgentMessage {
  id: string;
  role: string;
  text: string;
  sender: string;
  is_from_me: boolean;
  timestamp_ms: number;
  source: string;
  has_attachment: boolean;
}

/** Response from GET /messages (chat messages) */
export interface MessagesResponse {
  messages: ChatMessage[];
  is_thinking?: boolean;
}

/** A search result from FTS across chat messages */
export interface SearchResult {
  message_id: string;
  chat_id: string;
  snippet: string;
  role: "user" | "assistant";
  created_at: string;
  chat_title: string;
  rank: number;
}

/** Response from GET /chats/search */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
  count: number;
}

/** Response from GET /chats */
export interface ChatsResponse {
  chats: Conversation[];
}

/** Response from GET /api/app/sessions */
export interface AgentSessionsResponse {
  sessions: AgentSession[];
}

/** Response from GET /api/app/messages */
export interface AgentMessagesResponse {
  messages: AgentMessage[];
  has_more: boolean;
  is_thinking: boolean;
}

/** An SDK event from the agent session */
export interface SdkEvent {
  id: number;
  timestamp: number;
  session_name: string;
  chat_id: string | null;
  event_type: string;
  tool_name: string | null;
  tool_use_id: string | null;
  duration_ms: number | null;
  is_error: boolean;
  payload: string | null;
  num_turns: number | null;
}

/** Response from GET /api/app/sdk-events */
export interface SdkEventsResponse {
  events: SdkEvent[];
}

// ---------------------------------------------------------------------------
// Dashboard API types
// ---------------------------------------------------------------------------

/** System health snapshot from GET /api/dashboard/health */
export interface DashboardHealth {
  daemon_pid: number | null;
  daemon_running: boolean;
  uptime_seconds: number;
  active_sessions: number;
  total_sessions: number;
  total_bus_events: number;
  total_sdk_events: number;
  events_last_hour: number;
  sdk_events_last_hour: number;
  last_event_age_seconds: number | null;
  health_status: "unknown" | "healthy" | "degraded" | "down";
  active_reminders: number;
  facts_count: number;
  skills_count: number;
}

/** A session from GET /api/dashboard/sessions */
export interface DashboardSession {
  chat_id: string;
  session_name: string | null;
  contact_name: string;
  tier: string;
  type: string;
  source: string;
  model: string;
  created_at: string | null;
  updated_at: string | null;
  last_message_time: string | null;
  age_seconds: number | null;
}

/** Response from GET /api/dashboard/sessions */
export interface DashboardSessionsResponse {
  sessions: DashboardSession[];
  total: number;
  by_tier: Record<string, number>;
}

/** A reminder from GET /api/dashboard/tasks */
export interface DashboardReminder {
  id: string;
  title: string;
  schedule: string;
  timezone: string;
  next_fire: string | null;
  last_fired: string | null;
  fired_count: number;
  last_error: string | null;
  status: string;
}

/** Response from GET /api/dashboard/tasks */
export interface DashboardTasksResponse {
  reminders: DashboardReminder[];
  recent_task_events: Array<{
    type: string;
    timestamp: number;
    key: string;
    task_id: string | null;
    title: string | null;
  }>;
}

/** A skill from GET /api/dashboard/skills */
export interface DashboardSkill {
  name: string;
  description: string;
  path: string;
  has_scripts: boolean;
  script_count: number;
  scripts: string[];
  file_count: number;
}

/** Response from GET /api/dashboard/skills */
export interface DashboardSkillsResponse {
  skills: DashboardSkill[];
  total: number;
}

/** Quota bucket used in CCU response */
export interface QuotaBucket {
  utilization: number;
  resets_at: string;
}

/** A bus event from GET /api/dashboard/events */
export interface DashboardEvent {
  topic: string;
  partition: number;
  offset: number;
  timestamp: number;
  type: string;
  source: string;
  key: string;
  payload_preview: string;
  age_seconds: number;
}

/** Response from GET /api/dashboard/events */
export interface DashboardEventsResponse {
  events: DashboardEvent[];
  total_count: number;
  max_offset: number;
}

/** Response from GET /api/dashboard/ccu */
export interface DashboardCcuResponse {
  active_block: Record<string, unknown> | null;
  recent_blocks: Array<Record<string, unknown>>;
  daily: Array<Record<string, unknown>>;
  daily_totals: Record<string, unknown>;
  quota: {
    five_hour?: QuotaBucket | null;
    seven_day?: QuotaBucket | null;
    seven_day_sonnet?: QuotaBucket | null;
    seven_day_opus?: QuotaBucket | null;
  } | null;
  _loading: boolean;
  _updated_at: string | null;
  _error: string | null;
  _quota_error: string | null;
}
