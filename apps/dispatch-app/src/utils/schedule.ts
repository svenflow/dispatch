/**
 * Convert a cron schedule string to a human-readable description.
 * Handles standard 5-field cron, ISO date strings, and interval patterns.
 */
export function humanSchedule(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) {
    // Not a standard cron — could be a one-shot ISO date
    if (schedule.match(/^\d{4}-\d{2}-\d{2}/)) {
      try {
        const d = new Date(schedule);
        return d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      } catch {
        return schedule;
      }
    }
    return schedule;
  }

  const [min, hour, dom, mon, dow] = parts;

  // Format time from cron hour/min fields
  const formatTime = (h: string, m: string): string => {
    if (h === "*" && m === "*") return "";
    const hr = parseInt(h, 10);
    const mn = parseInt(m, 10);
    if (isNaN(hr)) return "";
    const ampm = hr >= 12 ? "PM" : "AM";
    const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return isNaN(mn) ? `${h12} ${ampm}` : `${h12}:${mn.toString().padStart(2, "0")} ${ampm}`;
  };

  const dayNames: Record<string, string> = {
    "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed",
    "4": "Thu", "5": "Fri", "6": "Sat", "7": "Sun",
  };

  const timeStr = formatTime(hour, min);

  // Every minute
  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every minute";
  }

  // Every N minutes
  if (min.startsWith("*/") && hour === "*") {
    return `Every ${min.slice(2)} min`;
  }

  // Every hour at :MM
  if (min !== "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `Every hour at :${min.padStart(2, "0")}`;
  }

  // Daily at HH:MM
  if (hour !== "*" && dom === "*" && mon === "*" && dow === "*") {
    return timeStr ? `Daily at ${timeStr}` : "Daily";
  }

  // Weekly on specific days
  if (dow !== "*" && dom === "*" && mon === "*") {
    const days = dow.split(",").map((d) => dayNames[d] || d).join(", ");
    return timeStr ? `${days} at ${timeStr}` : days;
  }

  // Monthly on specific day
  if (dom !== "*" && mon === "*" && dow === "*") {
    const ordinal = dom === "1" ? "1st" : dom === "2" ? "2nd" : dom === "3" ? "3rd" : `${dom}th`;
    return timeStr ? `Monthly on the ${ordinal} at ${timeStr}` : `Monthly on the ${ordinal}`;
  }

  // Fallback — return raw cron
  return schedule;
}
