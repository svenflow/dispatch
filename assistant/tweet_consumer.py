"""
Tweet Consumer: watches tweets topic and posts tweets immediately.

Design: The consumer posts immediately when it sees a tweet.scheduled event.
Time-delay logic lives in the planner, which creates a one-shot reminder
for the chosen posting time. When that reminder fires, it produces the
tweet.scheduled bus event, and this consumer posts it right away.

This avoids sleeping in the consumer handler (which blocks the thread and
is fragile across restarts/rebalances).
"""

import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

TWITTER_CLI = Path.home() / ".claude" / "skills" / "twitter" / "scripts" / "twitter"


def handle_tweet_scheduled(records: list) -> None:
    """Handle tweet.scheduled events — post immediately."""
    for record in records:
        payload = record.payload
        text = payload.get("text", "")

        if not text:
            log.warning("tweet.scheduled event with empty text, skipping")
            continue

        # Skip test/dry-run events
        if payload.get("dry_run") or text.startswith("__TEST"):
            log.info("Skipping dry-run/test tweet: %s", text[:80])
            continue

        # Check staleness — if scheduled_for is way in the past (>24h), skip
        scheduled_for = payload.get("scheduled_for", "")
        if scheduled_for:
            try:
                post_at = datetime.fromisoformat(scheduled_for)
                if post_at.tzinfo is None:
                    from zoneinfo import ZoneInfo
                    post_at = post_at.replace(tzinfo=ZoneInfo("America/New_York"))
                age_hours = (datetime.now(timezone.utc) - post_at).total_seconds() / 3600
                if age_hours > 24:
                    log.warning("Tweet is %.1f hours stale, skipping: %s", age_hours, text[:80])
                    continue
            except (ValueError, TypeError):
                pass  # Can't parse — just post it

        # Post the tweet
        log.info("Posting tweet: %s", text[:80])
        try:
            result = subprocess.run(
                ["uv", "run", str(TWITTER_CLI), "post", text],
                capture_output=True,
                text=True,
                timeout=60,
                cwd=str(Path.home()),
            )
            if result.returncode == 0:
                log.info("Tweet posted successfully: %s", result.stdout.strip()[:200])
            else:
                log.error("Tweet post failed (rc=%d): stderr=%s stdout=%s",
                          result.returncode, result.stderr[:500], result.stdout[:500])
        except subprocess.TimeoutExpired:
            log.error("Tweet post timed out after 60s")
        except Exception as e:
            log.error("Tweet post error: %s", e)
