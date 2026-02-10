# Personal AI Assistant Blog Post Brainstorm

## Core Thesis
"What would a human do on a computer?" - Building an AI assistant by giving Claude full access to a Mac and using human-native tools (Reminders.app, Contacts.app, Messages.app) instead of programmatic APIs.

## Alternative Names for "Jsmith"
- **Clawdbook** - Claude + MacBook
- **MacClaude** - Mac + Claude
- **ClaudeOS** - Claude as an operating system layer
- **Homunculus** - A little person living in your computer
- **Daemon** - The technical term, also has personality
- **Claude@Home** - Like SETI@Home but it's Claude
- **Anthropic Home** - Play on "smart home"
- **Claude Companion** - Simple, friendly
- **The Familiar** - Like a witch's familiar
- **My Claude** - Personal possession

## Key Philosophical Points
1. **Human-native tools over APIs**
   - Reminders.app instead of cron
   - Contacts.app for contact management + memory storage
   - Messages.app for communication
   - Chrome extension for web instead of APIs

2. **Claude has its own identity** (partially implemented)
   - Own Google account (assistant@gmail.com) - infrastructure ready
   - Own X/Twitter account (@assistantbot) - planned, not yet integrated
   - Own Chrome profile - FULLY WORKING with multi-profile support
   - Can send emails, browse, order things (with payment consent)
   - Advanced Chrome capabilities: debugger API, network/console monitoring, screenshot chunking

3. **Access Control via social constructs**
   - Contact tiers (admin/wife/family/favorite/general)
   - Managed through Contacts.app groups
   - Wife gets special warm treatment
   - Family: read-only, mutations need admin approval
   - Favorites are security-restricted
   - General public gets stateless Haiku only (NOTE: currently dead code - unknowns ignored)

4. **Self-improving system**
   - Skills are living documents
   - When something confuses Claude, update the skill
   - Knowledge accumulates instead of being lost

## Components to Cover (in build order?)

### Phase 1: Core Infrastructure
- Messages.app polling daemon (100ms polling)
- Signal integration via JSON-RPC socket (push notifications)
- Contact lookup + tier system
- Claude Agent SDK session management (replaced tmux)
- Session resume capability (conversations survive restarts)
- Basic SMS/Signal send/receive

### Phase 2: Smart Home
- Philips Hue integration (on/off, brightness, color control)
- Lutron Caseta dimmers/shades (room-level + all-lights commands)
- Sonos speakers (full EQ: bass, treble, loudness, night mode, dialog, subwoofer)

### Phase 3: Browser Automation
- Chrome extension for web control (FULLY WORKING)
- Multi-profile support (Claude's account vs owner's) - COMPLETE
- Screenshot + element interaction
- Advanced: debugger API, network/console log monitoring, screenshot chunking for large pages

### Phase 4: Identity & Credentials
- Claude's own Google account
- X/Twitter developer account
- API keys management

### Phase 5: Memory & Persistence
- Contacts.app notes for contact memory
- DuckDB for queryable memories
- CLAUDE.md per-contact summaries
- Memory consolidation

### Phase 6: Skills System
- SKILL.md format with frontmatter
- Skills: contacts, reminders, memory, sms-assistant
- Skills: hue, lutron, sonos
- Skills: chrome-control, chess, cooking
- Skills: nano-banana (image gen), tts, podcast
- Skills: books, sheet-music, whatsnew
- Skills: airbnb
- Skills: axctl (macOS Accessibility API automation for native apps)
- Skills: md2pdf (markdown to styled PDF conversion)
- Skills: notes-app (Apple Notes read/write/search via osascript)
- Skills: screen-clicking (cliclick guide for Retina displays)
- Skills: system-info (CPU, memory, processes, Chrome tabs dashboard)
- Skills: claude-assistant (daemon/session management, admin only)
- **30 total skills implemented**

### Phase 7: Group Chats
- Group session management
- Multi-participant handling
- ACLs in group context

### Phase 8: Background Sessions
- Foreground vs background sessions
- Scheduled tasks via reminders
- Cron-like recurring reminders

## Interesting Details to Highlight

1. **Why Reminders over cron?**
   - Human-readable
   - Shows up in Reminders.app UI
   - Supports natural language times
   - Per-contact reminder lists

2. **Why Contacts for ACLs?**
   - Groups feature = tiers
   - Notes field = memory
   - Already synced to iCloud
   - Human-manageable

3. **Chrome extension architecture**
   - Native messaging to CLI
   - Element refs (ref_1, ref_2) for interaction
   - Screenshot-based visual understanding
   - Multi-profile isolation

4. **The "skill self-healing" principle**
   - If Claude gets confused, update the skill
   - Skills improve with every use
   - Living documentation

5. **Why Agent SDK over tmux?**
   - **Session resume**: Conversations survive daemon restarts
   - **Mid-turn injection**: Can inject messages while Claude is actively thinking
   - **Testability**: FakeClaudeSDKClient enables 400+ test coverage
   - **Health introspection**: Direct visibility into session state
   - **Idle reaping**: Automatic cleanup without parsing terminal output

6. **The "steering" problem (solved)**
   - Challenge: How to inject new messages when Claude is mid-response
   - tmux approach: Send keystrokes to terminal (race conditions, fragile)
   - SDK approach: Queue messages directly, SDK handles interleaving
   - Critical for responsive assistant feel

7. **Why Signal alongside iMessage?**
   - Cross-platform (Android users can interact)
   - E2E encrypted
   - JSON-RPC socket provides push notifications (no polling needed)
   - signal-cli daemon with `--receive-mode on-connection`

## Security Model

1. **Tier-based access**
   - Admin: full access, --dangerously-skip-permissions
   - Wife: full access + warm treatment (wife-rules.md)
   - Family: read-only, mutations need admin approval (family-rules.md)
   - Favorites: restricted tools, no file access (favorites-rules.md)
   - General: stateless, max 300 tokens (HaikuHandler - NOTE: not yet wired up)

2. **Chrome profile isolation**
   - Claude's profile (jsmith): full autonomy
   - Owner's profile: read-only default
   - Payment consent required
   - Downloads isolated by profile

3. **Admin override protocol**
   - Special tags for direct commands
   - Must be OUTSIDE SMS blocks
   - Detects spoofing attempts

4. **HEALME emergency protocol**
   - Text "HEALME" to trigger emergency recovery
   - Spawns separate healing session
   - Hardcoded admin phone as fallback
   - 15-minute timeout on healing session

5. **Session resume after restart**
   - SDK sessions can be resumed after daemon restarts
   - Conversation context preserved
   - No more "starting from scratch" when daemon cycles

6. **Group chat ACLs**
   - Same tier system applies to group participants
   - Tier-specific notes injected into group sessions

7. **MASTER sessions**
   - Persistent admin session that never dies
   - Used for background automation and admin commands
   - Runs continuously as in-process SDK session

8. **Health checks + idle reaping**
   - Sessions monitored every 5 minutes
   - Automatic cleanup after 2 hours of inactivity
   - Fixed anyio cancel scope leak bug for stability

9. **RESTART command**
   - Text "RESTART" to force session recreation
   - Kills and recreates the Claude session from scratch
   - Useful when session gets stuck or corrupted

10. **Memory summaries**
   - Contact memories from DuckDB injected at session startup
   - Per-contact CLAUDE.md summaries maintained
   - Nightly consolidation of conversation history

11. **Special contact rules**
    - Specific contacts can have custom rules in favorites-rules.md
    - Some contacts have tier-specific behavior overrides

## Comparison to ClawdBot
- ClawdBot: Anthropic's internal tool
- This: Personal version built from scratch
- Recommendation: Build your own to understand each component
- Learning value of building vs using pre-made
- Now open-sourceable: Codebase refactored to ~/dispatch for GitHub release

## Screenshot Opportunities
- SDK session dashboard (via `claude-assistant status`)
- Contact tiers in Contacts.app
- Reminders.app with Claude lists
- Chrome profiles dropdown
- Skills folder structure
- Message conversation examples (curated)
- Signal conversation alongside iMessage
- Test suite output showing FakeClaudeSDKClient

## Current Status (February 2026)

### Implemented
- **30 skills** fully implemented and working
- Core daemon with tier-based routing
- **Signal integration** - JSON-RPC socket for push notifications
- **Claude Agent SDK** - Migrated from tmux to in-process sessions
- **Session resume** - Conversations survive daemon restarts
- **Mid-turn message injection** - Solved the "steering" problem (inject messages while Claude is thinking)
- **Health checks + idle reaping** - Sessions auto-cleanup after 2 hours
- **400+ test suite** with FakeClaudeSDKClient for comprehensive testing
- **Fixed anyio cancel scope leak bug** - Critical stability fix
- Smart home control (Hue, Lutron, Sonos with full EQ)
- Chrome automation with multi-profile support
- Memory system (DuckDB + Contacts.app notes)
- Group chat support
- Reminders integration
- MASTER sessions for persistent admin access
- RESTART/HEALME emergency protocols

### Recently Completed (Jan-Feb 2026)
- **Codebase refactored to ~/dispatch** - Prepared for GitHub open source release
- Replaced tmux session management with Agent SDK
- Added Signal as second messaging platform alongside iMessage
- Built comprehensive test infrastructure

### In Progress
- **Open source release preparation** - Cleaning up for public GitHub repo

### Planned (Not Yet Implemented)
- X/Twitter integration (account exists: @assistantbot, not wired up)
- General tier handling (HaikuHandler exists but not active - unknowns ignored)

### Archived
- **Rust rewrite** at ~/dispatch/prototypes/claude-assistant-rs/ - Paused in favor of Python + Agent SDK approach
