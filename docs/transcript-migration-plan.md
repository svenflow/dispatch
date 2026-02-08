# Transcript Folder Migration Plan v9

## Overview

Migrate transcript folders from flat structure to backend-prefixed structure for bidirectional mapping and collision prevention.

## New Structure

```
~/transcripts/imessage/_16175969496/
~/transcripts/imessage/2df6be1ed7534cd797e5fdb2c4bd6bd8/
~/transcripts/signal/_16175969496/
~/transcripts/signal/IVzMluTGB6Jn9YeC_wfFxfPZXpV6ZRjI-Igu8EOOVbo/
~/transcripts/master/  (UNCHANGED)
```

## Code Changes

### 1. common.py - ADD sanitize_chat_id()

```python
def sanitize_chat_id(chat_id: str) -> str:
    """Strip registry prefix, escape + for filesystem."""
    from assistant.backends import BACKENDS
    bare_id = chat_id
    for cfg in BACKENDS.values():
        if cfg.registry_prefix and chat_id.startswith(cfg.registry_prefix):
            bare_id = chat_id[len(cfg.registry_prefix):]
            break
    return bare_id.replace("+", "_")
```

### 2. common.py - REPLACE get_session_name()

```python
def get_session_name(chat_id: str, source: str = "imessage") -> str:
    """Generate session name from chat_id. Returns {backend}/{sanitized_chat_id}."""
    from assistant.backends import get_backend
    backend = get_backend(source)
    return f"{backend.name}/{sanitize_chat_id(chat_id)}"
```

### 3. sdk_backend.py - UPDATE get_session_name() CALLS

- Line 173 in create_session(): `get_session_name(chat_id, source=source)`
- Line 234 in _create_session_unlocked(): `get_session_name(chat_id, source=source)`
- Line 526 in create_background_session(): `get_session_name(chat_id, source=source)`
- Line 563 in inject_consolidation(): Get source from registry first, then `get_session_name(chat_id, source=source)`

### 4. sdk_backend.py - REPLACE get_group_session_name()

```python
def get_group_session_name(self, chat_id: str, display_name: str = None,
                            source: str = "imessage") -> str:
    existing = self.registry.get(chat_id)
    if existing:
        return existing["session_name"]
    return get_session_name(chat_id, source)
```

### 5. sdk_backend.py - UPDATE get_recent_output()

```python
session_name = get_session_name(session.chat_id, session.source)
```

### 6. sdk_backend.py - UPDATE inject_consolidation()

```python
async def inject_consolidation(self, contact_name: str, chat_id: str):
    reg = self.registry.get(chat_id)
    source = reg.get("source", "imessage") if reg else "imessage"
    fg_session_name = get_session_name(chat_id, source=source)
```

### 7. sdk_session.py - UPDATE session logging

```python
from assistant.common import get_session_name
session_name = get_session_name(chat_id, source)
log_name = session_name.replace("/", "-")
self._log = _get_session_logger(log_name)
```

### 8. transcript.py - FIX SDK path

```python
sanitized = session_name.replace("/", "-")
session_dir = projects_dir / f"-Users-{Path.home().name}-transcripts-{sanitized}"
```

### 9. read_transcript.py - FIX SDK path

```python
sanitized = session_name.replace("/", "-")
pattern = f"-Users-{username}-transcripts-{sanitized}"
```

### 10. memory.py - Registry lookup

Add at top:
```python
import json
REGISTRY_PATH = Path.home() / "dispatch/state/sessions.json"

def _load_registry() -> dict:
    if REGISTRY_PATH.exists():
        return json.loads(REGISTRY_PATH.read_text())
    return {}

def get_session_by_contact(contact_name: str) -> Optional[dict]:
    registry = _load_registry()
    contact_lower = contact_name.lower().replace(" ", "-")
    for entry in registry.values():
        entry_contact = entry.get("contact_name", "").lower().replace(" ", "-")
        if entry_contact == contact_lower:
            return entry
        entry_display = entry.get("display_name", "").lower().replace(" ", "-")
        if entry_display == contact_lower:
            return entry
    return None
```

Update sync_claude_md():
```python
def sync_claude_md(contact: str):
    entry = get_session_by_contact(contact)
    if not entry:
        print(f"No session found for contact: {contact}")
        return
    transcript_dir = Path(entry["transcript_dir"])
    claude_md_path = transcript_dir / "CLAUDE.md"
```

Update consolidate_memories():
```python
def consolidate_memories(contact: str):
    entry = get_session_by_contact(contact)
    if not entry:
        print(f"No session found for contact: {contact}")
        return []
    session_name = entry["session_name"]
    sanitized = session_name.replace("/", "-")
    contact_project = projects_dir / f"-Users-{username}-transcripts-{sanitized}"
```

### 11. menubar/app.py - Complete rewrite

Add imports:
```python
import json
REGISTRY_PATH = Path.home() / "dispatch/state/sessions.json"

def _load_registry() -> dict:
    if REGISTRY_PATH.exists():
        return json.loads(REGISTRY_PATH.read_text())
    return {}
```

Replace _get_contacts():
```python
def _get_contacts(self) -> list[tuple]:
    contacts = []
    active_sessions = self._get_active_sessions()

    if TRANSCRIPTS_DIR.exists():
        for backend_dir in sorted(TRANSCRIPTS_DIR.iterdir()):
            if not backend_dir.is_dir() or backend_dir.name.startswith('.'):
                continue
            if backend_dir.name == "master":
                contacts.append(("master", "master" in active_sessions))
                continue
            if backend_dir.name not in ("imessage", "signal", "test"):
                continue
            for session_dir in sorted(backend_dir.iterdir()):
                if not session_dir.is_dir() or session_dir.name.startswith('.'):
                    continue
                session_name = f"{backend_dir.name}/{session_dir.name}"
                is_active = session_name in active_sessions
                contacts.append((session_name, is_active))
    return contacts

def _get_active_sessions(self) -> set:
    registry = _load_registry()
    return {entry.get("session_name") for entry in registry.values() if entry.get("session_name")}
```

Replace _attach_session():
```python
def _attach_session(self, sender):
    """Open transcript directory in Finder (SDK sessions cannot be attached)."""
    session_name = sender.title.split(" ", 1)[1] if " " in sender.title else sender.title
    transcript_path = TRANSCRIPTS_DIR / session_name
    if transcript_path.exists():
        subprocess.run(["open", str(transcript_path)])
    else:
        rumps.notification("Claude Assistant", "Error", f"Transcript directory not found: {session_name}")
```

### 12. NEW: reply CLI

Create `~/.claude/skills/sms-assistant/scripts/reply`:

```python
#!/usr/bin/env -S uv run --script
# /// script
# dependencies = []
# ///
import sys
import json
import subprocess
from pathlib import Path

TRANSCRIPTS_DIR = Path.home() / "transcripts"
REGISTRY_PATH = Path.home() / "dispatch/state/sessions.json"
SEND_SMS = Path.home() / ".claude/skills/sms-assistant/scripts/send-sms"
SEND_SIGNAL = Path.home() / ".claude/skills/signal/scripts/send-signal"
SEND_SIGNAL_GROUP = Path.home() / ".claude/skills/signal/scripts/send-signal-group"

def is_group_chat_id(chat_id: str) -> bool:
    bare = chat_id
    for prefix in ["signal:", "test:"]:
        if chat_id.startswith(prefix):
            bare = chat_id[len(prefix):]
            break
    return not bare.startswith("+")

def strip_registry_prefix(chat_id: str) -> str:
    for prefix in ["signal:", "test:"]:
        if chat_id.startswith(prefix):
            return chat_id[len(prefix):]
    return chat_id

def main():
    if len(sys.argv) < 2:
        print("Usage: reply 'message'", file=sys.stderr)
        sys.exit(1)

    cwd = Path.cwd()
    try:
        parts = cwd.relative_to(TRANSCRIPTS_DIR).parts
    except ValueError:
        print(f"Error: Not in transcript directory", file=sys.stderr)
        sys.exit(1)

    if len(parts) < 2:
        print("Error: Not in session directory", file=sys.stderr)
        sys.exit(1)

    backend, folder = parts[0], parts[1]
    expected_transcript_dir = str(TRANSCRIPTS_DIR / backend / folder)

    try:
        registry = json.loads(REGISTRY_PATH.read_text())
    except Exception as e:
        print(f"Error: Could not load registry: {e}", file=sys.stderr)
        sys.exit(1)

    chat_id = None
    for entry in registry.values():
        if entry.get("transcript_dir") == expected_transcript_dir:
            chat_id = entry["chat_id"]
            break

    if not chat_id:
        print(f"Error: Session not found in registry", file=sys.stderr)
        sys.exit(1)

    bare_chat_id = strip_registry_prefix(chat_id)
    msg = sys.argv[1]

    if backend == "signal":
        if is_group_chat_id(chat_id):
            cmd = [str(SEND_SIGNAL_GROUP), bare_chat_id, msg]
        else:
            cmd = [str(SEND_SIGNAL), bare_chat_id, msg]
    else:
        cmd = [str(SEND_SMS), bare_chat_id, msg]

    result = subprocess.run(cmd)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
```

### 13. common.py - UPDATE wrap_sms footer

```python
**Important:** You are in a text message session. Communicate back with: ~/.claude/skills/sms-assistant/scripts/reply "message"
```

### 14. common.py - UPDATE wrap_group_message footer

```python
To reply: ~/.claude/skills/sms-assistant/scripts/reply "message"
```

## Migration Script

Save to `~/dispatch/scripts/migrate_transcripts.py` - see full script in implementation.

## Migration Steps

1. BACKUP
```bash
cp -r ~/transcripts ~/transcripts.bak
cp ~/dispatch/state/sessions.json ~/dispatch/state/sessions.json.bak
```

2. DEPLOY CODE CHANGES

3. DRY RUN
```bash
uv run ~/dispatch/scripts/migrate_transcripts.py --dry-run
```

4. STOP DAEMON
```bash
claude-assistant stop
touch /tmp/migration-in-progress
```

5. RUN MIGRATION
```bash
uv run ~/dispatch/scripts/migrate_transcripts.py
```

6. CLEAR SDK INDEXES
```bash
rm -rf ~/.claude/projects/*transcripts*
```

7. START DAEMON
```bash
rm /tmp/migration-in-progress
claude-assistant start
```

8. VERIFY - Run test plan

## Rollback

```bash
claude-assistant stop
rm -rf ~/transcripts
mv ~/transcripts.bak ~/transcripts
cp ~/dispatch/state/sessions.json.bak ~/dispatch/state/sessions.json
rm -rf ~/.claude/projects/*transcripts*
rm -f ~/.claude/skills/sms-assistant/scripts/reply
git checkout -- ~/dispatch/assistant/ ~/dispatch/menubar/ ~/dispatch/skills/
claude-assistant start
```

## Test Plan

1. Daemon Startup: `claude-assistant status`
2. Send Test Message from phone
3. Verify Registry: `cat ~/dispatch/state/sessions.json | jq`
4. Reply CLI: `cd ~/transcripts/imessage/_<phone> && reply "test"`
5. Group Chat Test
6. Memory Sync: `uv run memory.py sync "Contact Name"`
7. Session Restart: `claude-assistant restart-session imessage/_<phone>`
8. Menubar Test: Click contact, verify Finder opens
