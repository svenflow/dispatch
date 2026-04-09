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
  HealthEventsResponse,
  FactsResponse,
  Fact,
  UsageResponse,
  ConfigToggles,
  ConfigResponse,
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
  // Quota velocity
  velocity: null,
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

/** Fetch health diagnostic events from the bus */
export async function getDashboardHealthEvents(
  hours = 48,
  limit = 100,
): Promise<HealthEventsResponse> {
  const data = await apiRequest<Partial<HealthEventsResponse>>(
    "/api/dashboard/health-events",
    { params: { hours, limit } },
  );
  return {
    events: data.events ?? [],
    summary: {
      total: data.summary?.total ?? 0,
      verdicts: data.summary?.verdicts ?? 0,
      fatal_count: data.summary?.fatal_count ?? 0,
      stuck_count: data.summary?.stuck_count ?? 0,
      circuit_breaker_events: data.summary?.circuit_breaker_events ?? 0,
      quota_alerts: data.summary?.quota_alerts ?? 0,
    },
  };
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

// ---------------------------------------------------------------------------
// Facts / Knowledge Base
// ---------------------------------------------------------------------------

const DEFAULT_FACTS_RESPONSE: FactsResponse = {
  facts: [],
  total: 0,
};

const DEFAULT_USAGE_RESPONSE: UsageResponse = {
  sessions: [],
  total_cost: 0,
  total_tokens: 0,
  session_count: 0,
  since: "",
  _loading: false,
  _updated_at: null,
  _error: null,
};

/** Fetch all extracted facts */
export async function getDashboardFacts(): Promise<FactsResponse> {
  const data = await apiRequest<Partial<FactsResponse>>("/api/dashboard/facts");
  return withDefaults(DEFAULT_FACTS_RESPONSE, data);
}

/** Create a new manual fact */
export async function createFact(fact: {
  contact: string;
  fact_type: string;
  summary: string;
  details?: string;
  confidence?: number;
}): Promise<Fact> {
  return apiRequest<Fact>("/api/dashboard/facts", {
    method: "POST",
    body: fact,
  });
}

/** Update an existing fact */
export async function updateFact(
  id: number,
  updates: Partial<Pick<Fact, "summary" | "details" | "fact_type" | "active" | "confidence">>,
): Promise<Fact> {
  return apiRequest<Fact>(`/api/dashboard/facts/${id}`, {
    method: "PUT",
    body: updates,
  });
}

/** Delete a fact */
export async function deleteFact(id: number): Promise<void> {
  await apiRequest<{ status: string }>(`/api/dashboard/facts/${id}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Cost Analytics / Usage
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config Toggles
// ---------------------------------------------------------------------------

const DEFAULT_TOGGLES: ConfigToggles = {
  reminders_enabled: true,
  tasks_enabled: true,
};

/** Fetch current config toggles */
export async function getConfigToggles(): Promise<ConfigToggles> {
  const data = await apiRequest<Partial<ConfigToggles>>("/api/config/toggles");
  return withDefaults(DEFAULT_TOGGLES, data);
}

/** Update a config toggle */
export async function setConfigToggle(
  toggles: Partial<ConfigToggles>,
): Promise<ConfigToggles> {
  const data = await apiRequest<ConfigToggles>("/api/config/toggles", {
    method: "POST",
    body: toggles,
  });
  return data;
}

/** Fetch the full config */
export async function getConfig(): Promise<ConfigResponse> {
  const data = await apiRequest<ConfigResponse>("/api/config");
  return { sections: data.sections ?? [] };
}

/** Update a single config field */
export async function setConfigField(
  key: string,
  value: unknown,
): Promise<{ ok: boolean; key: string; value: unknown }> {
  return apiRequest("/api/config", {
    method: "POST",
    body: { key, value },
  });
}

/** Fetch per-session cost/usage data */
export async function getDashboardUsage(since?: string): Promise<UsageResponse> {
  const params: Record<string, string> = {};
  if (since) params.since = since;
  const data = await apiRequest<Partial<UsageResponse>>(
    "/api/dashboard/usage",
    { params },
  );
  return withDefaults(DEFAULT_USAGE_RESPONSE, data);
}
