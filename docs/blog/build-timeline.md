# Build Timeline - Personal AI Assistant

Extracted from 179 unique SMS requests across 30 transcript files.

## Day 1: January 24, 2026 - Foundation

### Morning/Early Afternoon
- **SMS basics** - Getting Claude to send/receive iMessages via osascript
- **Reactions/Tapbacks** - Attempting to add emoji reactions to messages
- **Image viewing** - Processing HEIC files from iPhone photos

### Mid-Afternoon
- **Escaping issues** - The infamous `\!` problem with bash escaping
- **sms-cli creation** - Built CLI tool in ~/code/sms-cli to handle escaping properly
- **Chrome access** - "ok nice now you have chrome access right?"

### Late Afternoon
- **Nano Banana setup** - Image generation skill
  - "go research nano banana pro"
  - "make a skill with frontmatter explaining how to use it"
  - "take this kids drawing and make it a realistic image"
- **Skills architecture** - Started formalizing skill structure with YAML frontmatter

### Evening
- **Chrome extension rebuild** - "go clone this somewhere and see what I did"
  - Built new extension from scratch
  - Native messaging host for CLI control
  - Screenshot and element interaction
- **Chess.com integration** - Login and game playing
- **Favorite tier security** - Rules for restricted users
  - "change the favorite rules to be nicer"
  - Admin override protocol established

## Day 2: January 25, 2026 - Identity & Persistence

### Early Morning
- **More chess** - "play all the chess games!"
- **Multi-profile Chrome** - "does our extension let us control multiple profiles simultaneously?"

### Late Morning
- **UV for Python** - "make sure we say always use uv for python never run it directly"
- **Extension auto-reload** - Testing if extension survives Chrome restart

### Afternoon
- **Second Chrome profile** - "i logged into a second profile in chrome can you see it"
- **Profile permissions** - Establishing read-only default for owner's account
  - assistant@gmail.com = Claude's account (full autonomy)
  - owner@gmail.com = Owner's account (read-only, needs consent)
- **Gmail access** - "show me my latest email in owner@gmail.com profile"

### Late Afternoon/Evening
- **Text-to-Speech research** - "how much does eleven labs cost"
- **Google Cloud TTS** - "let's try google cloud text to speech"
- **Private podcast feed** -
  - "convert any text article or pdf to long form audio"
  - Architecture discussion: ngrok vs tailscale vs GCS
  - Final: GCS bucket for podcast RSS feed
- **Spotify integration** - OAuth setup in owner's profile

### Night
- **Memory system design** - Major brainstorming session
  - "focus on the memory system for contacts and chats"
  - DuckDB for queryable memories
  - CLAUDE.md per-contact summaries
  - Contacts.app notes integration
  - Memory types: preference, fact, lesson, context
  - "types of memories - let claude decide this"
- **FG/BG sessions** - Foreground and background SDK sessions
  - "when the daemon restarts does it setup two claudes"
  - Nightly consolidation at 2am
- **Audio transcription** - Whisper integration for voice messages

## Day 3: January 26, 2026 - Polish & Integration

### Early Morning (1-4am)
- **Reminders system overhaul**
  - FG/BG targeting
  - Cron-like recurring reminders
  - "reminders are for you the assistant to execute"
- **Session restart prompts** - "read the last 10 messages, be smarter"
- **Tapback attempts** - UI scripting (later abandoned for emoji messages)
- **Sonos integration** - SSDP discovery, play/pause/volume/grouping

### Morning
- **Hue lights** - "turn all the hue lamps off"
- **Weather check** - Boston snowstorm monitoring

### Afternoon
- **whatsnew skill** - Trend research without dependencies
- **X Developer setup** - Discussed creating Twitter account for Claude (planned, not completed)
- **Group chat improvements**
  - "why didn't it text the group back immediately?"
  - Unified prompts between individual and group sessions
  - sms-cli for sending (no more osascript escaping issues)

### Evening
- **Blog post planning** - This document!

## Day 4: January 27, 2026 - Debugging & Resilience

### Early Morning (2-7am)
- **Flight reminder debugging** - UA 1008 BOS→SFO monitoring
  - Discovered reminder injection issues
  - Fixed TMUX environment variable leakage in daemon
- **Contact lookup failures** - "why is contact not found happening"
  - Root cause: Contacts.app wasn't running
  - Fixed contacts_core.py to auto-launch Contacts.app on error -600
- **Daemon subprocess fix** - Added get_clean_env() to strip TMUX vars
  - Prevents inject-prompt permission issues when daemon runs in tmux

### Morning
- **Memory system enhancements**
  - Added `edit` and `delete` commands to memory.py
  - Added file logging at ~/.claude/logs/memory.log
  - Now logs all SAVE, EDIT, DELETE, SYNC operations
- **Chess skill update** - Confirmed game.move() only animates, doesn't submit
  - Must click piece → click destination → click Submit for daily games
- **Blog post review** - Subagent verification of brainstorm, timeline, outline

### Key Fixes
- **HEALED logging** - Added to manager.log when sessions are killed/restarted after errors
- **Contacts.app resilience** - Auto-launch on AppleScript -600 errors
- **TMUX isolation** - Daemon subprocess calls now use clean environment

### Evening
- **Rust rewrite begun** - Started parallel implementation at ~/dispatch/prototypes/claude-assistant-rs/
  - Goal: Performance, type safety, and cleaner architecture
  - Coexists with Python daemon during transition
- **Search daemon (dispatch-search)** - Local semantic search service
  - Full-text search with FTS5
  - Vector embeddings via node-llama-cpp
  - Hybrid retrieval pipeline

### Notes
- nano-banana skill still uses `python3` shebang (violates uv rule - needs fixing)

## Day 5+: January 28, 2026 onwards - Search & Scale

### Search Infrastructure
- **dispatch-search daemon** - Comprehensive local search service
  - FTS (Full-Text Search) for keyword matching
  - Vector embeddings for semantic similarity
  - Hybrid retrieval combining both approaches
- **node-llama-cpp integration**
  - embeddinggemma-300M for document embeddings
  - qwen3-reranker for result ranking
  - Local inference, no API calls needed
- **Indexable sources**
  - Transcript history
  - CLAUDE.md files
  - Skill documentation
  - Contact memories

## Week 2: Late January - Early February 2026 - The SDK Migration

### January 28-31: Architecture Overhaul
- **tmux sessions → Claude Agent SDK** - Complete migration from external tmux processes to in-process SDK sessions
  - Sessions now run in-process via Claude Agent SDK
  - Direct control over session lifecycle
  - No more tmux buffer scraping for health checks
- **Session resume capability** - Sessions persist across daemon restarts
  - SDK session IDs stored in registry
  - Reconnect to existing conversations on daemon restart
  - No more lost context when daemon restarts
- **Health checks and idle reaping** - Automatic session management
  - Periodic health checks for stuck sessions
  - Idle sessions reaped after configurable timeout
  - Resources freed automatically

### January 30-31: Signal Integration
- **signal-cli JSON-RPC daemon** - Full Signal messenger support
  - signal-cli runs as daemon with `--receive-mode on-connection`
  - JSON-RPC socket at `/tmp/signal-cli.sock`
  - Unified message handling for both iMessage and Signal
- **Health monitoring** - Auto-restart on failure
  - Health checks every 5 minutes
  - Automatic daemon restart if socket unresponsive
  - Separate from iMessage polling (not dependent on it)

### Late January - Early February: Test Suite
- **Comprehensive test coverage** - 400+ tests
  - FakeClaudeSDKClient for deterministic testing
  - No real API calls in test suite
  - Tests for message routing, session management, tier logic
  - Full coverage of contact tier system
  - Integration tests for iMessage and Signal paths

## February 2-3, 2026 - The Steering Breakthrough

### The "Steering" Problem Solved
- **Mid-turn message injection** - Can inject messages while receive_messages() runs
  - Discovered that `query()` can be called while `receive_messages()` is active
  - Enables injecting new SMS messages into ongoing conversations
  - No need to wait for assistant to finish thinking
  - Critical for responsive assistant behavior
  - The "steering" metaphor: like steering a car while it's moving, not stopping to change direction

### Major Refactor: The GitHub Move
- **~/code/claude-assistant → ~/dispatch** - Codebase moved for open source
  - Cleaner name for public release
  - Core code paths updated throughout codebase
  - Ready for GitHub repository creation
- **Hardcoded path purge** - Fixed throughout codebase
  - Core code paths updated (some docs still reference old paths)
  - Skills and configs use `~` or relative paths
  - Portable between machines

### Critical Bug Fix: Cancel Scope Leak
- **anyio cancel scope crash** - Fixed daemon crashes on idle session kills
  - Root cause: calling `client.disconnect()` during active receive_messages()
  - Solution: Don't call disconnect(), just abandon the client
  - anyio cleans up the orphaned coroutine automatically
  - Daemon now stable during idle reaping
  - Hours of debugging to find this one - cancel scopes are tricky

## February 7, 2026 - Open Source Prep

### Ongoing
- **GitHub release preparation** - Getting dispatch ready for public
  - Documentation review and cleanup
  - Sensitive data scrubbing (API keys, phone numbers, personal info)
  - License selection
  - README and setup instructions
  - Example configurations for new users
- **Final testing** - Ensuring everything works after the refactor
  - Running full test suite (400+ tests passing)
  - Manual testing of iMessage and Signal flows
  - Verifying session resume works correctly

## Key Architectural Decisions (Chronological)

1. **Jan 24 AM**: Use osascript for Messages.app control
2. **Jan 24 PM**: Build dedicated sms-cli to handle escaping
3. **Jan 24 PM**: Rebuild Chrome extension from scratch (not Claude's built-in)
4. **Jan 24 EVE**: Skills use YAML frontmatter for discoverability
5. **Jan 25 AM**: Always use `uv` for Python (never python3 directly)
6. **Jan 25 PM**: Two Chrome profiles - Claude's own identity
7. **Jan 25 EVE**: DuckDB for memory, Contacts.app notes for persistence
8. **Jan 25 EVE**: FG/BG session architecture for async tasks
9. **Jan 26 AM**: Reminders.app for scheduling (not cron)
10. **Jan 26 PM**: Unified skill for both individual and group chats
11. **Jan 27 AM**: Auto-launch Contacts.app when not running (resilience)
12. **Jan 27 AM**: Strip TMUX env vars from daemon subprocess calls (isolation)
13. **Jan 27 AM**: Add file logging for memory operations (auditability)
14. **Jan 27 PM**: Persistent chat_id-based session registry (JSON mapping)
    - Registry maps chat_id → {session_name, contact_name, tier, last_message_time, ...}
    - Survives daemon restarts, enables lazy session creation
15. **Jan 27 PM**: Automatic health checking with pattern-based self-healing
    - Regex patterns detect error states in session output
    - Auto-kill and restart sessions showing error patterns
    - HEALED events logged for debugging
16. **Jan 27 PM**: In-memory contact cache for O(1) tier lookups
    - Contacts loaded once at startup, cached in memory
    - Avoids repeated AppleScript calls during message processing
17. **Jan 27 PM**: Contacts.app groups as source of truth for tier system
    - "Claude Admin", "Claude Wife", "Claude Family", "Claude Favorites"
    - Standard macOS app, no custom database needed
18. **Jan 27 PM**: GCS for podcast feed infrastructure
    - RSS feed hosted on Google Cloud Storage
    - TTS audio files uploaded to same bucket
    - Private podcast accessible only via signed URLs
19. **Jan 27 EVE**: Rust daemon rewrite begun (parallel development)
    - ~/dispatch/prototypes/claude-assistant-rs/ for performance-critical implementation
    - Shadow development: both versions can coexist during transition
20. **Jan 28-31**: tmux → Claude Agent SDK migration
    - In-process SDK sessions replace external tmux processes
    - Session resume via stored SDK session IDs
    - Eliminates tmux buffer scraping for health checks
21. **Jan 30-31**: Signal integration via signal-cli JSON-RPC
    - signal-cli daemon with `--receive-mode on-connection`
    - Unified message handling for iMessage + Signal
    - Health checks with auto-restart every 5 minutes
22. **Feb 2-3**: Steering discovery - mid-turn message injection
    - `query()` can be called while `receive_messages()` runs
    - Enables responsive assistant behavior without waiting
23. **Feb 2-3**: Codebase move ~/code/claude-assistant → ~/dispatch
    - Clean name for GitHub open source release
    - All hardcoded paths removed
24. **Feb 2-3**: anyio cancel scope fix for idle reaping
    - Don't call `client.disconnect()` during active receive_messages()
    - Just abandon the client, let anyio clean up
    - Daemon stable during idle session kills
25. **Feb 7**: Open source preparation for GitHub release
    - Documentation cleanup and sensitive data scrubbing
    - Example configurations for new users
    - Two weeks from first SMS to public release

## Recurring Themes

### "What would a human do?"
- Use Reminders.app (not cron)
- Use Contacts.app (not a database)
- Use Chrome (not APIs)
- Have your own email account
- Have your own social media

### Self-Improvement / Self-Healing Skills
- "When something confuses you, update the skill"
- Skills are living documents
- Knowledge accumulates
- **Self-healing pattern**: If a skill is confusing or a task fails, update SKILL.md immediately
- Fixes should be generalizable, not one-off patches

### Shadow Development Encouraged
- Experimental implementations can coexist with production code
- Rust rewrite runs in parallel with Python daemon
- New approaches tested without disrupting working system
- Gradual migration possible once new version proves stable

### Identity
- Claude has its own Google account (assistant@gmail.com)
- Claude has its own X/Twitter account (planned: @assistantbot)
- Claude has its own Chrome profile (working)
- Payments still require human consent

### Access Control via Social Constructs
- Contact tiers via Contacts.app groups
- Wife gets special treatment
- Favorites are security-restricted
- General public gets stateless API only
