/**
 * Shared quota display helpers used by both dashboard.tsx and quota.tsx.
 */

/** Color for quota bar based on utilization percentage */
export function quotaBarColor(util: number): string {
  if (util >= 80) return "#ef4444";
  if (util >= 50) return "#eab308";
  return "#22c55e";
}

/** Format a reset time as a human-readable relative string */
export function formatResetTime(resetsAt: string): string {
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (diffMs <= 0) {
    // Reset time in the past — quota already reset, waiting for fresh data
    const agoMs = Math.abs(diffMs);
    const agoHours = Math.floor(agoMs / 3_600_000);
    if (agoHours > 24) return "stale data";
    return "refreshing…";
  }
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ---------------------------------------------------------------------------
// Quota burn-rate prediction
// ---------------------------------------------------------------------------

export interface QuotaPrediction {
  status: "safe" | "tight" | "danger" | "unknown";
  projectedAtReset: number;
  hitsQuotaInMinutes?: number;
  message: string;
}

// Only predict for main quotas — model-specific sub-quotas (Opus/Sonnet)
// have bursty usage patterns where linear projection isn't meaningful.
const PERIOD_HOURS: Record<string, number> = {
  "5-Hour": 5,
  "7-Day": 168,
};

/**
 * Compute a burn-rate projection for a quota bar.
 * Returns status indicator + human-readable message.
 */
export function computeQuotaPrediction(
  label: string,
  utilization: number,
  resetsAt: string,
): QuotaPrediction {
  const now = Date.now();
  const resetMs = new Date(resetsAt).getTime();
  const remainingMs = resetMs - now;

  // Already past reset
  if (remainingMs <= 0) {
    return { status: "unknown", projectedAtReset: utilization, message: "" };
  }

  const periodHours = PERIOD_HOURS[label];
  if (!periodHours) {
    return { status: "unknown", projectedAtReset: utilization, message: "" };
  }

  const periodMs = periodHours * 3_600_000;
  const periodStartMs = resetMs - periodMs;
  const elapsedMs = now - periodStartMs;

  // Too early in period (<15 min elapsed)
  if (elapsedMs < 15 * 60_000) {
    return { status: "unknown", projectedAtReset: utilization, message: "" };
  }

  // Near reset (<30 min left)
  if (remainingMs < 30 * 60_000) {
    return { status: "safe", projectedAtReset: utilization, message: "resets soon" };
  }

  // Basically no usage
  if (utilization < 1) {
    return { status: "safe", projectedAtReset: 0, message: "on pace" };
  }

  const elapsedHours = elapsedMs / 3_600_000;
  const remainingHours = remainingMs / 3_600_000;
  const burnRatePerHour = utilization / elapsedHours;
  const projected = utilization + burnRatePerHour * remainingHours;

  // Format the time-to-hit-100 string
  function formatHitsIn(hoursToHit: number): string {
    const mins = Math.round(hoursToHit * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 24) {
      const d = Math.floor(h / 24);
      return `~${d}d ${h % 24}h`;
    }
    return h > 0 ? `~${h}h ${m}m` : `~${m}m`;
  }

  // Already very high — always warn
  if (utilization >= 90) {
    const hoursToHit = burnRatePerHour > 0 ? (100 - utilization) / burnRatePerHour : Infinity;
    if (hoursToHit < remainingHours) {
      return {
        status: "danger",
        projectedAtReset: projected,
        hitsQuotaInMinutes: Math.round(hoursToHit * 60),
        message: `hits quota in ${formatHitsIn(hoursToHit)}`,
      };
    }
    return { status: "tight", projectedAtReset: projected, message: `~${Math.round(projected)}% at reset` };
  }

  if (projected > 100) {
    const hoursToHit = (100 - utilization) / burnRatePerHour;
    return {
      status: "danger",
      projectedAtReset: projected,
      hitsQuotaInMinutes: Math.round(hoursToHit * 60),
      message: `hits quota in ${formatHitsIn(hoursToHit)}`,
    };
  }

  if (projected > 80) {
    return { status: "tight", projectedAtReset: projected, message: `~${Math.round(projected)}% at reset` };
  }

  return { status: "safe", projectedAtReset: projected, message: `~${Math.round(projected)}% at reset` };
}

export function predictionIcon(status: QuotaPrediction["status"]): string {
  switch (status) {
    case "safe": return "✅";
    case "tight": return "⚠️";
    case "danger": return "🔴";
    default: return "";
  }
}

export function predictionColor(status: QuotaPrediction["status"]): string {
  switch (status) {
    case "safe": return "#22c55e";
    case "tight": return "#eab308";
    case "danger": return "#ef4444";
    default: return "#52525b";
  }
}

/** Format ISO timestamp to short time string, with date context for multi-day ranges */
export function formatTimestamp(isoStr: string, rangeHours?: number): string {
  const d = new Date(isoStr);
  if (rangeHours && rangeHours > 24) {
    return d.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
