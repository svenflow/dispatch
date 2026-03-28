/**
 * Format a timestamp as a relative time string.
 *
 * - < 60s: "just now"
 * - < 60m: "2m ago"
 * - < 24h: "1h ago"
 * - < 48h: "yesterday"
 * - otherwise: short date (e.g. "Mar 15")
 */
export function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Future dates: show "in X" format
  if (diffMs < 0) {
    const futureSec = Math.floor(-diffMs / 1000);
    const futureMin = Math.floor(futureSec / 60);
    const futureHr = Math.floor(futureMin / 60);
    const futureDay = Math.floor(futureHr / 24);

    if (futureSec < 60) return "in < 1 min";
    if (futureMin < 60) return `in ${futureMin}m`;
    if (futureHr < 24) {
      const remainMin = futureMin % 60;
      return remainMin > 0 ? `in ${futureHr}h ${remainMin}m` : `in ${futureHr}h`;
    }
    if (futureDay === 1) return "tomorrow";
    return `in ${futureDay} days`;
  }

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffHr < 48) return "yesterday";

  // For older dates, show short month + day
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();

  // If different year, include it
  if (date.getFullYear() !== now.getFullYear()) {
    return `${month} ${day}, ${date.getFullYear()}`;
  }

  return `${month} ${day}`;
}

/**
 * Format a Unix-ms timestamp as a relative time string.
 * Similar to relativeTime but takes a number (ms since epoch).
 */
export function timeAgoMs(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Format a Unix-ms timestamp as a short date string.
 * e.g. "Mar 28, 3:45 PM"
 */
export function formatDateMs(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a duration in ms as a human-readable string.
 * e.g. 1500 → "1.5s", 42 → "42ms"
 */
export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
