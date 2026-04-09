---
name: auth-dialog-monitor
description: macOS auth dialog monitor — auto-approves safe dialogs, escalates unknown ones to admin via SMS. Use when managing auth dialog auto-approve rules, investigating pending escalations, or approving/denying dialogs. Trigger words - auth dialog, permission dialog, approve dialog, escalation.
---

# Auth Dialog Monitor

Monitors macOS authentication dialogs (SecurityAgent), auto-resolves safe ones via rule engine, and escalates unknown dialogs to admin via SMS with a CLI for resolution.

## Architecture

```
SecurityAgent dialog appears
        ↓
AuthDialogMonitor (~/dispatch/assistant/auth_dialog.py)
  - Detects via PyObjC AX tree polling
  - Traces provenance to SDK session via process tree
  - Classifies via rule engine (config.local.yaml)
        ↓
   ┌────────────┬─────────────────┐
   │ Safe rule  │  Unknown/unsafe │
   │ → auto-    │  → escalate to  │
   │   approve  │  admin via SMS  │
   └────────────┴─────────────────┘
        ↓
Admin replies → auth-dialog-approve CLI resolves it
```

Runs as part of the main dispatch daemon. Bus events logged to `system` topic.

## CLI: auth-dialog-approve

```bash
~/dispatch/bin/auth-dialog-approve list                  # List pending escalated dialogs
~/dispatch/bin/auth-dialog-approve info <dialog_id>      # Show dialog details
~/dispatch/bin/auth-dialog-approve approve <dialog_id>   # Click OK/Allow
~/dispatch/bin/auth-dialog-approve deny <dialog_id>      # Click Cancel
~/dispatch/bin/auth-dialog-approve always <dialog_id>    # Approve + add auto-approve rule to config
```

Pending dialogs stored in: `~/dispatch/state/auth_dialog_pending.json`
Resolution via PyObjC AXUIElement (no daemon IPC needed).

## Escalation Flow

1. Unknown dialog detected → admin notified via SMS with dialog details
2. Admin replies (e.g. "approve" or "deny") → triggers inject-prompt into admin session
3. Admin session runs `auth-dialog-approve approve <id>` or `deny <id>`
4. Use `always` to also add a permanent auto-approve rule

## Auto-Approve Rules

Rules live in `~/dispatch/config.local.yaml` under `auth_dialog.auto_approve_rules`:

```yaml
auth_dialog:
  auto_approve_rules:
    - name: "homebrew installs"
      app_pattern: "installer"
      action_pattern: "install"
      action: approve
    - name: "my script"
      app_pattern: "python"
      action_pattern: "keychain"
      action: approve
```

All patterns are regex, case-insensitive. Fields: `app_pattern`, `action_pattern`, `dialog_type`.

Config hot-reloads via SIGHUP — no daemon restart needed.

## Bus Events

| Event | Topic | When |
|-------|-------|------|
| `auth_dialog.detected` | system | Dialog appears |
| `auth_dialog.approved` | system | Auto-approved by rule |
| `auth_dialog.escalated` | system | Sent to admin |
| `auth_dialog.approved` | system | Human approved |
| `auth_dialog.denied` | system | Human denied |
| `auth_dialog.always_approved` | system | Approved + rule added |

Search bus: `cd ~/dispatch && uv run python -m bus.cli search "auth_dialog" --limit 20`

## Dialog Types

- `password` — requires password entry (APPROVE_WITH_PASSWORD if rule matches)
- `allow_deny` — simple Allow/Deny buttons
- `ok_cancel` — OK/Cancel buttons

## Notes

- Resolution is done in-process via PyObjC — passwords never leave the process
- `always` command adds rule to config.local.yaml and auto-approves existing pending dialog
- If dialog disappears before resolution, `approve`/`deny` will report "dialog not found"
