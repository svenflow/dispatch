# 07: Session Management

> **Note:** This guide has been merged into `06-skills-system.md`. See the "Session Management (How It Works)" section there.

The session management system is already implemented in the codebase. The merged section in step 6 covers:
- Architecture overview
- Key files (sdk_session.py, sdk_backend.py, common.py)
- Session registry (sessions.json)
- Key behaviors (lazy creation, auto-resume, health checks, idle reaping, steering)
- Verification commands

## Quick Verification

```bash
# Check active sessions
~/dispatch/bin/claude-assistant status

# Check registry
cat ~/dispatch/state/sessions.json | jq keys
```

## What's Next

Continue to `08-browser-automation.md` for Chrome control.
