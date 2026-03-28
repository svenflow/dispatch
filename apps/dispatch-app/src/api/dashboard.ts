import { apiRequest } from "./client";
import { withDefaults } from "../utils/defaults";
import type {
  DashboardHealth,
  DashboardSessionsResponse,
  DashboardTasksResponse,
  DashboardSkillsResponse,
  DashboardSkillDetail,
  DashboardEventsResponse,
  DashboardCcuResponse,
  QuotaHistoryResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Default values for defensive access
// ---------------------------------------------------------------------------

const DEFAULT_HEALTH: DashboardHealth = {
  daemon_pid: null,
  daemon_running: false,
  uptime_seconds: 0,
  active_sessions: 0,
  total_sessions: 0,
  total_bus_events: 0,
  total_sdk_events: 0,
  events_last_hour: 0,
  sdk_events_last_hour: 0,
  last_event_age_seconds: null,
  health_status: "unknown",
  active_reminders: 0,
  facts_count: 0,
  skills_count: 0,
  // Watchdog
  watchdog_running: false,
  watchdog_last_check_seconds: null,
  watchdog_crash_count: 0,
  watchdog_last_recovery: null,
  watchdog_backoff_seconds: 0,
  // Signal
  signal_running: false,
  signal_socket_age_seconds: null,
  // Session health
  session_health: { healthy: 0, degraded: 0, unhealthy: 0, degraded_sessions: [] },
};

const DEFAULT_SESSIONS_RESPONSE: DashboardSessionsResponse = {
  sessions: [],
  total: 0,
  by_tier: {},
};

const DEFAULT_TASKS_RESPONSE: DashboardTasksResponse = {
  reminders: [],
  recent_task_events: [],
};

const DEFAULT_SKILLS_RESPONSE: DashboardSkillsResponse = {
  skills: [],
  total: 0,
};

const DEFAULT_EVENTS_RESPONSE: DashboardEventsResponse = {
  events: [],
  total_count: 0,
  max_offset: 0,
};

const DEFAULT_CCU_RESPONSE: DashboardCcuResponse = {
  active_block: null,
  recent_blocks: [],
  daily: [],
  daily_totals: {},
  quota: null,
  _loading: false,
  _updated_at: null,
  _error: null,
  _quota_error: null,
  _quota_updated_at: null,
};

const DEFAULT_QUOTA_HISTORY: QuotaHistoryResponse = {
  snapshots: [],
  heavy_sessions: [],
  current_backoff: { backoff_seconds: 900, consecutive_failures: 0 },
  current_quota: null,
  _quota_updated_at: null,
};

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** Fetch system health snapshot */
export async function getDashboardHealth(): Promise<DashboardHealth> {
  const data = await apiRequest<Partial<DashboardHealth>>(
    "/api/dashboard/health",
  );
  return withDefaults(DEFAULT_HEALTH, data);
}

/** Fetch all active sessions */
export async function getDashboardSessions(): Promise<DashboardSessionsResponse> {
  const data = await apiRequest<Partial<DashboardSessionsResponse>>(
    "/api/dashboard/sessions",
  );
  return withDefaults(DEFAULT_SESSIONS_RESPONSE, data);
}

/** Fetch Claude Code Usage (quota data). */
export async function getDashboardCcu(): Promise<DashboardCcuResponse> {
  const data = await apiRequest<Partial<DashboardCcuResponse>>(
    "/api/dashboard/ccu",
  );
  return withDefaults(DEFAULT_CCU_RESPONSE, data);
}

/** Fetch quota utilization history from bus events. */
export async function getDashboardQuotaHistory(
  hours = 24,
): Promise<QuotaHistoryResponse> {
  const data = await apiRequest<Partial<QuotaHistoryResponse>>(
    "/api/dashboard/quota-history",
    { params: { hours } },
  );
  return withDefaults(DEFAULT_QUOTA_HISTORY, data);
}

/** Fetch tasks and reminders */
export async function getDashboardTasks(): Promise<DashboardTasksResponse> {
  const data = await apiRequest<Partial<DashboardTasksResponse>>(
    "/api/dashboard/tasks",
  );
  return withDefaults(DEFAULT_TASKS_RESPONSE, data);
}

/** Fetch bus events */
export async function getDashboardEvents(
  limit = 100,
): Promise<DashboardEventsResponse> {
  const data = await apiRequest<Partial<DashboardEventsResponse>>(
    "/api/dashboard/events",
    { params: { limit } },
  );
  return withDefaults(DEFAULT_EVENTS_RESPONSE, data);
}

/** Fetch hourly event histogram for the last 24h */
export async function getDashboardHistogram(): Promise<{ buckets: Array<{ hour: string; count: number }>; hours: number }> {
  const data = await apiRequest<{ buckets: Array<{ hour: string; count: number }>; hours: number }>(
    "/api/dashboard/events-histogram",
    { params: { hours: 24 } },
  );
  return { buckets: data.buckets ?? [], hours: data.hours ?? 24 };
}

/** Fetch skills list */
export async function getDashboardSkills(): Promise<DashboardSkillsResponse> {
  const data = await apiRequest<Partial<DashboardSkillsResponse>>(
    "/api/dashboard/skills",
  );
  return withDefaults(DEFAULT_SKILLS_RESPONSE, data);
}

/** Fetch detailed usage metrics for a single skill */
export async function getDashboardSkillDetail(
  skillName: string,
  days = 30,
): Promise<DashboardSkillDetail> {
  const data = await apiRequest<Partial<DashboardSkillDetail>>(
    `/api/dashboard/skills/${encodeURIComponent(skillName)}`,
    { params: { days } },
  );
  return {
    name: data.name ?? skillName,
    total_invocations: data.total_invocations ?? 0,
    last_used_ms: data.last_used_ms ?? null,
    avg_duration_ms: data.avg_duration_ms ?? null,
    error_count: data.error_count ?? 0,
    invocations_by_session: data.invocations_by_session ?? [],
    recent_invocations: data.recent_invocations ?? [],
    skill_md: data.skill_md ?? null,
  };
}
