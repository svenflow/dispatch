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
  reactions?: string[]; // emoji reactions on this message
  widget_data?: WidgetData | null;
  widget_response?: WidgetResponse | null;
  responded_at?: string | null;
}

// ---------------------------------------------------------------------------
// Widget types
// ---------------------------------------------------------------------------

/** Option for a question widget */
export interface QuestionOption {
  label: string;
  description?: string | null;
}

/** A single question in an ask_question widget */
export interface WidgetQuestion {
  question: string;
  options: QuestionOption[];
  multi_select?: boolean;
  include_other?: boolean; // default true — shows "Other" option with text input
}

/** ask_question widget payload */
export interface AskQuestionWidgetData {
  v: number;
  type: "ask_question";
  questions: WidgetQuestion[];
}

/** A step in a progress_tracker widget */
export interface ProgressStep {
  label: string;
  status?: "pending" | "in_progress" | "complete" | "error"; // default "pending"
  detail?: string | null;
}

/** progress_tracker widget payload (display-only) */
export interface ProgressTrackerWidgetData {
  v: number;
  type: "progress_tracker";
  title?: string | null;
  steps: ProgressStep[];
}

/** A pin on a map_pin widget */
export interface MapPinItem {
  latitude: number;
  longitude: number;
  label?: string | null;
}

/** map_pin widget payload (display-only) */
export interface MapPinWidgetData {
  v: number;
  type: "map_pin";
  pins: MapPinItem[];
  zoom?: number; // default 14
  title?: string | null;
}

/** Union of all widget data types (extensible via registry pattern) */
export type WidgetData =
  | AskQuestionWidgetData
  | ProgressTrackerWidgetData
  | MapPinWidgetData;

/** A single question's answer in a form response */
export interface QuestionAnswer {
  question_index: number;
  selected: string[];
  other_text?: string | null;
}

/** Batch response to an ask_question widget (all questions answered at once) */
export interface FormResponse {
  answers: QuestionAnswer[];
}

/** Union of all widget response types */
export type WidgetResponse = FormResponse;

/** Response from POST /widget-response */
export interface WidgetResponseResult {
  status: "answered" | "already_answered";
  response: FormResponse;
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
  model?: string | null; // Model used for this session (e.g. "opus", "sonnet")
  status?: string | null; // Session status: "active" | "idle"
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

/** A degraded/unhealthy session in the health summary */
export interface DegradedSession {
  name: string;
  contact: string;
  status: "degraded" | "unhealthy";
  last_check_seconds: number;
  issue: string;
}

/** Session health summary */
export interface SessionHealthSummary {
  healthy: number;
  degraded: number;
  unhealthy: number;
  degraded_sessions: DegradedSession[];
}

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

  // Watchdog
  watchdog_running: boolean;
  watchdog_last_check_seconds: number | null;
  watchdog_crash_count: number;
  watchdog_last_recovery: string | null;
  watchdog_backoff_seconds: number;

  // Signal
  signal_running: boolean;
  signal_socket_age_seconds: number | null;

  // Session health
  session_health: SessionHealthSummary;

  // Quota velocity (5h utilization delta over ~1 hour)
  velocity: { delta: number; period_minutes: number } | null;
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
  last_used_ms: number | null;
  total_invocations: number;
}

/** Response from GET /api/dashboard/skills */
export interface DashboardSkillsResponse {
  skills: DashboardSkill[];
  total: number;
}

/** Detailed usage metrics for a single skill */
export interface DashboardSkillDetail {
  name: string;
  total_invocations: number;
  last_used_ms: number | null;
  avg_duration_ms: number | null;
  error_count: number;
  invocations_by_session: Array<{ session_name: string; count: number }>;
  recent_invocations: Array<{
    timestamp_ms: number;
    session_name: string;
    chat_id: string | null;
    duration_ms: number | null;
    is_error: boolean;
  }>;
  skill_md: string | null;
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
    extra_usage?: {
      is_enabled: boolean;
      monthly_limit: number | null;
      used_credits: number | null;
      utilization: number | null;
    } | null;
  } | null;
  _loading: boolean;
  _updated_at: string | null;
  _error: string | null;
  _quota_error: string | null;
  _quota_updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Health Events dashboard types
// ---------------------------------------------------------------------------

/** A health diagnostic event from the bus */
export interface HealthEvent {
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
  age_seconds: number;
}

/** Summary counts for health events */
export interface HealthEventSummary {
  total: number;
  verdicts: number;
  fatal_count: number;
  stuck_count: number;
  circuit_breaker_events: number;
  quota_alerts: number;
}

/** Response from GET /api/dashboard/health-events */
export interface HealthEventsResponse {
  events: HealthEvent[];
  summary: HealthEventSummary;
}

/** A single quota utilization snapshot from bus events */
export interface QuotaSnapshot {
  ts: string;
  five_hour: number | null;
  seven_day: number | null;
}

/** A session that was active between two quota snapshots */
export interface QuotaHeavySession {
  window_start: string;
  window_end: string;
  five_hour_delta: number;
  seven_day_delta: number;
  session_name: string;
  display_name: string;
  event_count: number;
  duration_sec: number;
  tools: string[];
}

/** Response from GET /api/dashboard/quota-history */
export interface QuotaHistoryResponse {
  snapshots: QuotaSnapshot[];
  heavy_sessions: QuotaHeavySession[];
  current_backoff: {
    backoff_seconds: number;
    consecutive_failures: number;
  };
  current_quota: DashboardCcuResponse["quota"];
  _quota_updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Facts / Knowledge Base types
// ---------------------------------------------------------------------------

/** A single extracted fact from GET /api/dashboard/facts */
export interface Fact {
  id: number;
  contact: string;
  fact_type: string;
  summary: string;
  details: string | null;
  confidence: number;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  source: string;
}

/** Response from GET /api/dashboard/facts */
export interface FactsResponse {
  facts: Fact[];
  total: number;
}

// ---------------------------------------------------------------------------
// Cost Analytics / Usage types
// ---------------------------------------------------------------------------

/** Per-session usage data from GET /api/dashboard/usage */
export interface UsageSession {
  session_id: string;
  contact_name: string | null;
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  model_breakdown: Record<string, { cost: number; input_tokens: number; output_tokens: number }>;
  conversation_count: number;
}

/** Response from GET /api/dashboard/usage */
export interface UsageResponse {
  sessions: UsageSession[];
  total_cost: number;
  total_tokens: number;
  session_count: number;
  since: string;
  _loading: boolean;
  _updated_at: string | null;
  _error: string | null;
}
