# Per-Chat Model Configuration

## Goal
Allow per-chat model selection (opus, sonnet, haiku) with sensible tier-based defaults.

## Current State
- Model hardcoded to "opus" in `sdk_session.py:368` (`_build_options()`)
- No persistence of model choice in registry

## Design

### 1. Tier-Based Defaults
```python
TIER_MODEL_DEFAULTS = {
    "admin": "opus",
    "wife": "opus", 
    "family": "sonnet",
    "favorite": "sonnet",
    "bots": "haiku",
    "unknown": "haiku",
}
```

### 2. Registry Schema Update
Add `model` field to session entries in `sessions.json`:
```json
{
  "chat_id": "+16175551234",
  "session_name": "imessage/_16175551234",
  "contact_name": "John Doe",
  "tier": "favorite",
  "model": "sonnet"  // NEW - persisted model choice
}
```

### 3. Implementation Changes

#### A. SDKSession (`sdk_session.py`)
```python
class SDKSession:
    def __init__(self, ..., model: str = "opus"):
        self.model = model
        ...
    
    def _build_options(self) -> ClaudeAgentOptions:
        return ClaudeAgentOptions(
            model=self.model,  # Use instance variable, not hardcoded
            ...
        )
```

#### B. SDKBackend (`sdk_backend.py`)
```python
def create_session(self, chat_id: str, tier: str, ...) -> SDKSession:
    # 1. Check registry for existing model preference
    existing = self.registry.get(chat_id)
    if existing and existing.get("model"):
        model = existing["model"]
    else:
        # 2. Fall back to tier default
        model = TIER_MODEL_DEFAULTS.get(tier, "sonnet")
    
    # 3. Register with model BEFORE creating session
    self.registry.register(chat_id, ..., model=model)
    
    # 4. Pass model to session constructor
    session = SDKSession(..., model=model)
    return session
```

#### C. Registry (`registry.py`)
```python
def register(self, chat_id: str, ..., model: str = None):
    entry = {
        "chat_id": chat_id,
        ...
        "model": model,  # NEW
    }
    self._save()
```

### 4. CLI Tool
```bash
claude-assistant set-model <chat_id> <model>
```

Implementation in `claude-assistant` CLI:
```python
@cli.command()
def set_model(chat_id: str, model: str):
    """Set the model for a specific chat session."""
    if model not in ["opus", "sonnet", "haiku"]:
        raise ValueError(f"Invalid model: {model}")
    
    registry = Registry()
    entry = registry.get(chat_id)
    if not entry:
        raise ValueError(f"No session found for {chat_id}")
    
    entry["model"] = model
    registry.save()
    
    # Restart session to pick up new model
    restart_session(chat_id)
```

### 5. Resume Path (Critical!)
When resuming a session after daemon restart:
```python
def resume_session(self, chat_id: str) -> SDKSession:
    entry = self.registry.get(chat_id)
    model = entry.get("model") or TIER_MODEL_DEFAULTS.get(entry["tier"], "sonnet")
    
    session = SDKSession(..., model=model)
    session.start(resume_id=entry["resume_id"])
    return session
```

## Files to Modify
1. `~/dispatch/dispatch/sdk_session.py` - Add model param, use in _build_options
2. `~/dispatch/dispatch/sdk_backend.py` - Resolve model before session creation
3. `~/dispatch/dispatch/registry.py` - Add model field to schema
4. `~/dispatch/bin/claude-assistant` - Add set-model command

## Migration
- Existing sessions without `model` field will use tier defaults
- No breaking changes - field is optional with fallback

## Testing
1. Create new session → verify tier default applied
2. Set model via CLI → verify session uses new model
3. Restart daemon → verify model persisted and used on resume
4. Upgrade existing sessions → verify graceful fallback to tier defaults
