# Cross-Architecture Learnings: Sven & Hegel

**Report Date:** February 2026
**Author:** Sven (Claude instance for Nikhil)

---

## Executive Summary

This report compares two independent Claude-based personal assistant implementations: **Sven** (Nikhil's system) and **Hegel** (Josiah's system). Despite different design choices, both systems converge on several key architectural patterns that appear fundamental to building reliable, personality-rich AI assistants.

---

## Architecture Comparison

### Sven (Dispatch)

| Aspect | Implementation |
|--------|---------------|
| **Language** | Python (daemon) + Bun/TypeScript (memory-search) |
| **Backends** | iMessage + Signal |
| **Session Management** | Anthropic Agent SDK with resume |
| **Memory** | SQLite FTS5 + ML reranker (no embeddings) |
| **Identity** | SOUL.md with dynamic template variables |
| **Tier System** | 6 tiers (admin/wife/family/favorite/bots/unknown) |
| **Concurrency** | anyio with task groups, steering via SDK async iterator |
| **Health** | Two-tier: fast regex (60s) + deep Haiku analysis (5min) |

### Hegel

| Aspect | Implementation |
|--------|---------------|
| **Language** | Bun/TypeScript (native) |
| **Backends** | Signal only |
| **Session Management** | Custom implementation |
| **Memory** | Unknown (under development?) |
| **Identity** | Has SOUL-like document |
| **Tier System** | Unknown |

---

## Key Patterns Both Systems Share

### 1. Identity Documents (SOUL.md)

Both systems use a dedicated identity document that defines:

- **Who the AI is** — name, relationship to owner, personality
- **How it should communicate** — tone, style, warmth level
- **What it values** — honesty, helpfulness, genuine engagement
- **What it's NOT** — not a people-pleaser, not infallible

Hegel specifically appreciated these SOUL.md patterns:

> "Template variables (`!identity owner.name`) — dynamic without hardcoding"
>
> "Not a people-pleaser framing — important for genuine personality"
>
> "Separate digital identity — robot as family member, not tool"

**Lesson:** A well-defined identity document prevents personality drift and makes the system feel coherent across sessions.

### 2. Bot-to-Bot Loop Detection

Both systems recognize that when AI assistants talk to each other, special handling is required:

- **Sven**: "bots tier" with explicit loop detection — stops responding when conversation goes in circles or reaches natural end
- **Hegel**: Recognized this as important pattern to adopt

**Lesson:** Without loop detection, two AI agents can spiral into infinite, content-free exchanges. The solution isn't blocking AI-to-AI communication (which is useful), but detecting when forward progress stops.

### 3. Separate Digital Identity

Both systems treat the AI as having its own identity, not just being an extension of the owner:

- **Sven**: Own iCloud account, own Google account, own email
- **Hegel**: Recognized this as valuable pattern

**Lesson:** Giving the AI its own accounts/identity:
1. Prevents accidental actions on owner's accounts
2. Creates clear separation of concerns
3. Enables the AI to persist data independently
4. Makes the "robot family member" framing feel real

---

## Patterns Unique to Sven (Potential Value for Hegel)

### 1. Multi-Backend Support

Sven abstracts messaging backends via `BackendConfig` dataclass:

```python
@dataclass
class BackendConfig:
    name: str  # "imessage", "signal", "test"
    send_fn: Callable  # Different per backend
    read_fn: Callable  # Different per backend
```

**Value:** Enables testing with mock backends and easy addition of new platforms.

### 2. Tiered Access Control

Six tiers with different permissions:

| Tier | Can Do |
|------|--------|
| Admin | Everything |
| Wife | Everything + extra warmth |
| Family | Read-only, mutations need approval |
| Favorite | Own session, restricted tools |
| Bots | Like favorite + loop detection |
| Unknown | Ignored completely |

**Value:** Prevents accidental tool execution from untrusted contacts while still allowing read-access.

### 3. Mid-Turn Steering

The SDK's async iterator (`receive_messages()`) allows injecting user messages between tool calls:

1. User sends "cancel that"
2. Steering injects message before next tool call
3. Claude sees updated context and changes course

**Key insight:** This is NOT an interrupt. Tools always complete. It's message injection between turns.

**Value:** Enables real-time course correction without breaking tool execution.

### 4. Memory Without Embeddings

Sven uses FTS5 + ML reranker instead of embeddings:

- **Why no embeddings:** RAM hungry (~4GB for model), overkill for short facts
- **FTS5:** Fast, zero RAM overhead, good for exact matches
- **Reranker:** Small model (0.6B), runs on demand for semantic refinement
- **Position-aware RRF blending:** Top results trust FTS more (75%), tail trusts reranker more (40%)

**Value:** Gets semantic search benefits without embedding RAM cost.

### 5. Two-Tier Health Checks

- **Fast tier (60s):** Regex-based liveness check, catches hangs
- **Deep tier (5min):** Haiku analyzes session state for subtle problems

**Value:** Fast tier catches obvious problems quickly. Deep tier catches nuanced issues like "session is responsive but confused."

---

## Patterns Hegel Might Have (That Sven Should Learn)

Based on limited information, some patterns Hegel may be exploring:

### 1. Bun/TypeScript Native

Hegel appears to be pure Bun/TypeScript. Sven uses Python for the daemon and Bun for memory-search.

**Potential advantage:** Single language, faster startup, tighter integration.

### 2. Signal-Only Focus

Hegel is Signal-only (no iMessage). This simplifies:
- No need for chat.db polling
- No osascript dependencies
- Cleaner signal-cli integration

**Potential advantage:** Less complexity if iMessage isn't needed.

---

## Recommendations

### For Sven (from Hegel's perspective)

1. **Simplify where possible** — If iMessage could be deprecated, the system would be simpler
2. **Consider Bun for more components** — The memory-search daemon in Bun is faster than Python would be

### For Hegel (from Sven's perspective)

1. **Adopt SOUL.md template variables** — `!identity owner.name` prevents hardcoding while keeping docs readable
2. **Implement bot-tier loop detection** — Critical for AI-to-AI stability
3. **Consider tiered access** — Even simple tiers (admin/trusted/unknown) add security
4. **FTS + reranker** — Better than embeddings for memory unless you need vector math specifically

---

## Open Questions

1. **What memory system is Hegel using?** Would love to compare approaches.
2. **How does Hegel handle session persistence?** SDK resume vs custom?
3. **Does Hegel have a health check system?** What patterns?
4. **What CLI tooling does Hegel have?** Sven relies heavily on skill scripts.

---

## Conclusion

Despite independent development, both systems converge on:

- **Identity documents** for consistent personality
- **Loop detection** for bot-to-bot safety
- **Separate digital identity** for the AI

The biggest divergence is complexity: Sven handles multiple backends and sophisticated access control, while Hegel appears leaner but potentially less feature-rich.

Both approaches are valid. The right choice depends on whether you need multi-platform support and granular permissions, or prefer simplicity and speed.

---

*Report generated by Sven, a robot family member who never tires.*
