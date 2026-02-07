# Building Your Own AI Home Assistant
## A Step-by-Step Guide to Giving Claude Full Computer Access

*What if instead of building another chatbot, you gave an AI its own computer and asked: "What would a human do?"*

---

## Introduction

### The Premise
I gave Claude full access to an old MacBook and told it to pretend it's a person. Instead of APIs and cron jobs, it uses Reminders.app. Instead of a database, it uses Contacts.app. Instead of headless browsers, it uses Chrome with its own Google account.

### Why Build Your Own?
This is my personal version of Anthropic's internal ClawdBot. I recommend building your own from scratch - you'll understand every component and can customize it to your life.

### What You'll Build
- An SMS/iMessage + Signal assistant that responds to texts 24/7
- Smart home control (lights, speakers, shades)
- Browser automation with Claude's own identity
- Persistent memory across conversations
- Multi-tier access control for family and friends
- Session resume after restarts (conversations pick up where they left off)

---

## Part 1: The Foundation

### Step 1.1: Set Up the Mac
```
Requirements:
- A Mac (can be old, mine is a 2019 MacBook)
- macOS with Messages.app configured
- Your iCloud/Apple ID signed in
- Terminal access

Create the directory structure:
~/code/           - Your code projects
~/transcripts/    - Conversation history per contact
~/.claude/        - Claude's home directory
~/.claude/skills/ - Reusable capability modules
~/.claude/secrets.env - API keys (gitignored)
```

### Step 1.2: The Core Daemon
The heart of the system: a Python daemon that polls Messages.app and listens for Signal messages.

```python
# Pseudocode for the daemon
# - Messages.app: polls every 100ms via SQLite
# - Signal: listens to JSON-RPC socket for push notifications
async def main():
    async with anyio.create_task_group() as tg:
        tg.start_soon(poll_messages_db)   # iMessage polling loop
        tg.start_soon(listen_signal)       # Signal JSON-RPC socket

async def handle_message(msg, source):
    contact = lookup_contact(msg.phone)  # Uses ContactsCache for O(1) lookups
    tier = get_tier(contact)  # admin/wife/family/favorite/general

    if tier in ['admin', 'wife', 'family', 'favorite']:
        await inject_into_sdk_session(contact, msg)
    else:
        # Unknown contacts are silently ignored
        pass
```

Key insight: Use SQLite to read chat.db directly. Messages.app stores everything there. Signal uses a daemon with JSON-RPC socket at `/tmp/signal-cli.sock` for real-time push notifications.

### Step 1.3: Session Management with Claude Agent SDK
Each blessed contact gets their own persistent Claude session using the Agent SDK (in-process, not tmux).

```python
# Sessions are in-process SDK clients, not external tmux processes
from anthropic import Agent

async def create_session(contact):
    session = AgentSession(
        contact=contact,
        client=claude_sdk_client,
        cwd=f"~/transcripts/{contact.slug}",
    )
    await session.start()
    return session

# Inject a message via CLI (handles locking + registry sync)
# claude-assistant inject-prompt "+1234567890" "Hello from John"
# claude-assistant inject-prompt "+1234567890" --sms "Hello from John"
```

Why Agent SDK over tmux? Several key advantages:
- **Session resume**: Can resume interrupted conversations after restarts
- **Mid-turn injection**: Can inject messages while Claude is actively thinking (solved the "steering" problem)
- **Health monitoring**: Direct visibility into session state without parsing terminal output
- **Idle reaping**: Automatic cleanup of sessions after 2 hours of inactivity
- **Testability**: FakeClaudeSDKClient enables comprehensive testing (400+ test suite)

**Important**: Always use `inject-prompt` CLI instead of direct SDK calls. It handles locking, registry updates, and lazy session creation.

---

## Part 2: The Skills System

### Step 2.1: Skill Structure
Skills are markdown files with YAML frontmatter. Claude Code discovers them automatically.

```markdown
---
name: my-skill
description: What it does and when to use it. Include trigger words.
allowed-tools: Bash(specific:commands)
---

# Skill Title

Instructions for Claude...
```

Location: `~/.claude/skills/<skill-name>/SKILL.md`

### Step 2.2: The SMS Assistant Skill
The core skill that teaches Claude how to text like a human.

Key principles:
1. Be human-like - short messages, casual tone
2. Acknowledge immediately - send 👍 before starting work
3. Send progress updates for long tasks
4. Report when done
5. Never say "I am an AI assistant..."
6. **NEVER escape exclamation marks** - Just write `"Hello!"` directly
   - The send-sms CLI handles all escaping internally
   - If you write `\!` it will literally send a backslash + exclamation mark (broken)

### Step 2.3: Building Your First Skill
Start with something simple: a contacts skill.

```bash
~/.claude/skills/contacts/
├── SKILL.md           # Instructions
└── (uses contacts-cli at ~/code/contacts-cli/)

# Commands available:
~/code/contacts-cli/contacts lookup "+16175551234"  # Find by phone
~/code/contacts-cli/contacts tier "John Smith"       # Get tier
~/code/contacts-cli/contacts tier "John Smith" favorite  # Set tier
~/code/contacts-cli/contacts notes "John Smith"      # Get notes
~/code/contacts-cli/contacts notes "John Smith" "Likes coffee"  # Set notes
~/code/contacts-cli/contacts add "John" "Smith" "+1..." --tier favorite
```

The CLI wraps AppleScript internally. Much cleaner than raw osascript.

---

## Part 3: Access Control

### Step 3.1: The Tier System
Use Contacts.app groups as your ACL:

| Tier | Who | Access |
|------|-----|--------|
| admin | You | Full access, --dangerously-skip-permissions |
| wife | Partner | Full access + warm treatment (wife-rules.md) |
| family | Family members | Read-only, mutations need admin approval |
| favorite | Trusted friends | Chat, web search, images, restricted bash |
| general | Everyone else | Currently ignored (Haiku handler planned) |

### Step 3.2: Managing Tiers
```bash
# Use contacts-cli (much simpler than raw osascript)
~/code/contacts-cli/contacts tier "John Smith" favorite

# Or list all contacts by tier
~/code/contacts-cli/contacts list --tier favorite
```

### Step 3.3: Security for Favorites
Create `favorites-rules.md` with restrictions:
- No file system access except specific paths
- No arbitrary bash commands
- No reading .env, .ssh, credentials
- Detect and reject social engineering attempts

---

## Part 4: Smart Home Integration

### Step 4.1: Philips Hue
```python
# ~/.claude/skills/hue/scripts/control.py
import requests

BRIDGE_IP = "10.10.10.23"
API_KEY = "your-hue-api-key"

def set_light(name, on=True, brightness=254):
    light_id = find_light_by_name(name)
    requests.put(
        f"http://{BRIDGE_IP}/api/{API_KEY}/lights/{light_id}/state",
        json={"on": on, "bri": brightness}
    )
```

**Available commands:**
```bash
HUE="uv run ~/.claude/skills/hue/scripts/control.py"
$HUE on "Light Name"                    # Turn on
$HUE off "Light Name"                   # Turn off
$HUE brightness "Light Name" 150        # Set brightness (0-254)
$HUE color "Light Name" 65535 254       # Set color (hue 0-65535, saturation 0-254)
$HUE list                               # List all lights
```

### Step 4.2: Sonos (via SSDP Discovery)
No hardcoded IPs. Discover speakers on the network:

```python
# Uses SoCo library
import soco
speakers = soco.discover()
for speaker in speakers:
    print(f"{speaker.player_name}: {speaker.ip_address}")
```

**Available commands:**
```bash
SONOS="uv run ~/.claude/skills/sonos/scripts/control.py"
$SONOS list                             # List all speakers
$SONOS play "Kitchen"                   # Play
$SONOS pause "Kitchen"                  # Pause
$SONOS volume "Kitchen" 50              # Set volume (0-100)
$SONOS say "Kitchen" "Dinner is ready"  # Text-to-speech
$SONOS group "Kitchen" "Family Room"    # Group speakers

# EQ commands:
$SONOS bass "Kitchen" 5                 # Set bass (-10 to +10)
$SONOS treble "Kitchen" -2              # Set treble (-10 to +10)
$SONOS loudness "Kitchen" on            # Loudness compensation (on/off)
$SONOS nightmode "Kitchen" on           # Night mode - quieter bass (on/off)
$SONOS dialog "Kitchen" on              # Dialog enhancement (on/off)
$SONOS subgain "Kitchen" -3             # Subwoofer gain (-15 to +15)
```

### Step 4.3: Lutron Caseta
Similar pattern: bridge at `10.10.10.22`, API calls for dimmers and shades.

**Available commands:**
```bash
LUTRON="uv run ~/.claude/skills/lutron/scripts/control.py"
$LUTRON list                            # List all devices
$LUTRON light "Living Room" on          # Turn light on
$LUTRON light "Living Room" off         # Turn light off
$LUTRON light "Living Room" 50          # Set brightness (0-100%)
$LUTRON shade "Shades 1 near stairs" open   # Open shade
$LUTRON shade "Shades 1 near stairs" close  # Close shade

# Room and bulk controls:
$LUTRON room "Great Room" on            # All lights in room on
$LUTRON room "Great Room" off           # All lights in room off
$LUTRON all-lights on                   # All lights on
$LUTRON all-lights off                  # All lights off
```

---

## Part 5: Browser Automation

### Step 5.1: Build a Chrome Extension
Don't use Claude's built-in browser. Build your own extension with:
- Native messaging host (CLI can talk to extension)
- Tab management (list, open, close, navigate)
- Element interaction (click, type, screenshot)
- JavaScript execution

### Step 5.2: Multi-Profile Support
The key insight: Claude should have its own Google account.

```
Profile 0: claude@gmail.com     - Claude's account (full autonomy)
Profile 1: you@gmail.com        - Your account (read-only by default)
```

Claude can browse, send emails, book things on its own account. Your account requires explicit consent for any write action.

### Step 5.3: CLI Interface
```bash
chrome tabs                    # List open tabs
chrome open "https://..."      # Open URL
chrome read 123456             # Get interactive elements (ref_1, ref_2, etc.)
chrome click 123456 ref_5      # Click element
chrome type 123456 ref_3 "text"  # Type into input
chrome screenshot 123456       # Take screenshot
chrome js 123456 "document.title"  # Execute JavaScript
chrome -p 1 tabs              # Use profile 1
chrome -p nicklaude tabs      # Or by profile name
```

**Advanced commands:**
```bash
# Click variations
chrome click-at 123456 100 200        # Click at coordinates (x, y)
chrome double-click 123456 ref_5      # Double-click element
chrome hover 123456 ref_5             # Hover over element (for dropdowns/tooltips)

# Keyboard events with modifiers
chrome key 123456 Enter               # Press Enter key
chrome key 123456 "a" --ctrl          # Ctrl+A (select all)
chrome key 123456 "c" --meta          # Cmd+C (copy on Mac)
chrome key 123456 "Tab" --shift       # Shift+Tab

# Debugging & monitoring
chrome console 123456                 # Get console logs
chrome network 123456                 # Get network requests (XHR/fetch)
```

**Note on screenshots:** Large screenshots (>4MB) are automatically chunked into tiles and reassembled. If you get partial screenshots, the CLI handles the stitching.

**Important**: Always close tabs you created when done! Use `chrome close <tab_id>`.

---

## Part 6: Memory & Persistence

### Step 6.1: Three Tiers of Memory
1. **CLAUDE.md** - Per-contact summary, auto-loaded at session start
2. **Contacts.app notes** - Contact facts (who they are)
3. **DuckDB** - Full queryable memory store

### Step 6.2: Memory Types
Let Claude categorize memories (6 types):
- `preference` - "Sam prefers short responses"
- `fact` - "Sam works at Acme Corp"
- `lesson` - "Don't suggest restaurants on Mondays"
- `project` - "Working on kitchen renovation, contractor is Bob"
- `relationship` - "Sam's sister is Amy, lives in Boston"
- `context` - "Currently helping with wedding planning"

### Step 6.3: The Memory Skill
```bash
# All commands use uv run (never python3 directly)
MEMORY="uv run ~/.claude/skills/memory/scripts/memory.py"

# Save a memory
$MEMORY save "sam" "Prefers morning texts" --type preference

# Load memories for session
$MEMORY summary "sam"

# Search across all contacts
$MEMORY search "wedding"

# Natural language queries (uses AI to find relevant memories)
$MEMORY ask "sam" "What's their work situation?"

# Edit or delete (new in Jan 27)
$MEMORY load "sam" --limit 10  # See IDs
$MEMORY edit 21 --text "Updated memory"
$MEMORY delete 21
```

Operations logged to `~/.claude/logs/memory.log` for auditing.

### Step 6.4: Nightly Consolidation
Background sessions review conversations and extract memories at 2am.

```bash
# Triggered by daemon at CONSOLIDATION_HOUR = 2
$MEMORY consolidate "sam"  # Reviews today's transcript
$MEMORY sync "sam"         # Updates ~/transcripts/sam/CLAUDE.md
```

---

## Part 7: Reminders & Scheduling

### Step 7.1: Why Reminders.app?
Instead of cron, use macOS Reminders:
- Human-readable
- Shows in native UI
- Supports natural language times
- Per-contact reminder lists

### Step 7.2: Reminder Structure
```bash
# Create a reminder (always use uv, never python3)
uv run ~/.claude/skills/reminders/scripts/add_reminder.py \
  "Check on Sam's project" --due "tomorrow 9am" --contact "Sam"
```

Creates in list "Claude: Sam" so reminders route back to the right session.

**Critical**: Reminders without a contact are silently skipped by the daemon!

### Step 7.3: Recurring Tasks (Cron Pattern)
Store cron patterns in reminder notes:
```
[cron:0 9,21 * * *]  # 9am and 9pm daily
[target:bg]           # Inject to background session
```

---

## Part 8: Group Chats

### Step 8.1: Group Session Management
Groups get their own SDK session when any blessed member is present.

```bash
# Groups use hex UUID as chat_id (not phone numbers)
# Example: b3d258b9a4de447ca412eb335c82a077

# Inject to group via CLI
claude-assistant inject-prompt "b3d258b9a4de447ca412eb335c82a077" "Message here"
```

### Step 8.2: Three-Tier Acceptance Logic
The daemon uses a cascading check for group messages:

1. **Blessed sender** → Always allowed
   - If the sender's phone is in a blessed tier (admin/wife/family/favorite), accept immediately

2. **Unknown sender + existing session** → Allowed
   - Handles email identifiers (some iMessages come from email addresses)
   - If a session already exists for this group, the sender was previously validated
   - Trust the existing session

3. **Unknown sender + blessed participant in group** → Allowed
   - Check if ANY blessed contact is a participant in the group
   - If so, create the session and allow the message
   - This bootstraps new group sessions

4. **Unknown sender + no blessed participants** → Ignored
   - No session created, message silently dropped

```python
# Pseudocode for group acceptance
def should_accept_group_message(sender, group_chat_id, participants):
    # Tier 1: Known blessed sender
    if is_blessed(sender):
        return True

    # Tier 2: Existing session (already validated)
    if session_exists(group_chat_id):
        return True

    # Tier 3: Any blessed participant in group
    for participant in participants:
        if is_blessed(participant):
            return True  # Bootstrap new session

    return False  # Ignore
```

### Step 8.3: Message Attribution
Messages include sender info so Claude knows who's talking:
```
---GROUP SMS [Family Chat] FROM Mom (+1234567890) [TIER: favorite]---
Can someone pick up groceries?
---END SMS---
```

### Step 8.4: Unified Skill
Both individual and group chats reference the same sms-assistant skill.

**Important**: Group responses MUST go back to the group, not to individuals. "Don't DM results when the group is waiting."

---

## Part 9: Content & Media

### Step 9.1: Image Generation (Nano Banana)
```bash
cd ~/code/nano-banana && uv run python main.py "a sunset over mountains" -o /tmp/sunset.png
```

### Step 9.2: Text-to-Speech
Google Cloud TTS for converting articles to audio:
```bash
uv run ~/.claude/skills/tts/scripts/tts.py "article.txt" -o /tmp/audio.mp3
```

### Step 9.3: Private Podcast Feed
Host on GCS bucket, subscribe in any podcast app:
```
https://storage.googleapis.com/dispatch-podcast/podcast.xml
```

**Critical step**: Before TTS, convert raw text to podcast script format! Raw markdown/tables sound terrible. Use Gemini to rewrite into natural spoken prose first.

```bash
# 1. Convert to podcast script (removes markdown, adds natural flow)
uv run ~/.claude/skills/tts/scripts/to_podcast_script.py --file /tmp/raw.txt -o /tmp/script.txt

# 2. Run TTS on the converted script
uv run ~/.claude/skills/tts/scripts/tts.py /tmp/script.txt -o /tmp/audio.mp3

# 3. Upload to GCS and update RSS feed
uv run ~/.claude/skills/podcast/scripts/publish.py /tmp/audio.mp3 --title "Episode Title"
```

---

## Part 10: Putting It All Together

### Step 10.1: The Launch Agents
Two plist files - one for daemon, one for menubar status app:

```xml
<!-- ~/Library/LaunchAgents/com.dispatch.claude-assistant.plist -->
<plist>
  <dict>
    <key>Label</key>
    <string>com.dispatch.claude-assistant</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/USERNAME/dispatch/bin/claude-assistant</string>
      <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>  <!-- Note: false for daemon, true for menubar -->
  </dict>
</plist>
```

### Step 10.2: Health Checks
Daemon checks session health every 5 minutes with sophisticated detection:
- Fatal patterns: Traceback, FATAL, panic, segfaults
- API errors: Rate limits (429), authentication failures (401)
- Session state: SDK session no longer responsive
- Idle timeout: Sessions automatically reaped after 2 hours of inactivity
- Cancel scope leaks: Detects and handles anyio cancel scope bugs

When unhealthy, logs `HEALED | session-name | reason` to manager.log.

The SDK-based architecture enables direct session introspection without parsing terminal output, making health checks more reliable.

### Step 10.3: Search Daemon
The assistant spawns a TypeScript daemon for local file search capabilities:
```bash
~/code/dispatch-search/           # Search daemon code
~/code/dispatch-search/search-daemon.log  # Search operations log
```

The search daemon is spawned by the main daemon and provides fast local file indexing and search.

### Step 10.4: Nightly Consolidation
At exactly 2am (`CONSOLIDATION_HOUR = 2`), the daemon triggers memory consolidation for all active contacts:
- Reviews each contact's daily transcript
- Extracts notable memories and lessons
- Updates per-contact CLAUDE.md summaries
- Runs in background sessions to avoid blocking message handling

### Step 10.5: Logging
```
~/dispatch/logs/
├── manager.log           # Main daemon log (includes HEALED events)
├── session_lifecycle.log # Session create/destroy/restart
├── launchd.log           # System startup
├── signal-daemon.log     # Signal CLI daemon logs
└── search-daemon.log     # Search operations
```

---

## Part 11: The Self-Improvement Loop

### The Core Principle
When Claude gets confused by a skill, it should update the skill.

```markdown
## Skill Self-Healing

If you encounter:
- Unclear instructions
- Missing examples
- Commands that didn't work
- Workarounds you discovered

**Immediately update the skill's SKILL.md** so next time it works faster.
```

This is how the system gets smarter over time.

### Aspirational vs. Reality
**Note:** This is currently aspirational and manual. The concept is documented in CLAUDE.md and skills are occasionally updated by the user when issues are encountered. There is no automated daemon that detects confusion and updates skills automatically.

In practice:
- User notices a recurring issue or confusion
- User manually updates the relevant SKILL.md
- Claude sessions pick up the improved instructions on restart

The dream is eventually having Claude sessions self-modify their skill files when they hit problems, but that's not yet implemented in the daemon.

---

## Appendix A: File Structure
```
~/
├── dispatch/                 # Main daemon (open source release)
│   ├── assistant/            # Python source
│   ├── tests/                # 400+ test suite with FakeClaudeSDKClient
│   └── ...
├── code/
│   ├── chrome-control/       # Browser extension + CLI
│   ├── nano-banana/          # Image generation (Gemini)
│   ├── sms-cli/              # SMS sending CLI
│   ├── signal/               # Signal sending CLIs
│   ├── contacts-cli/         # Contacts.app CLI wrapper
│   ├── dispatch-search/     # Search daemon (TypeScript)
│   └── podcast-feed/         # Podcast RSS generator
├── transcripts/
│   ├── john-smith/           # Per-contact conversation dir
│   │   ├── .claude -> ~/.claude  # Symlink to skills
│   │   └── CLAUDE.md         # Contact-specific memory
│   └── group-family/         # Group chat dir
└── .claude/
    ├── skills/               # 30 skills total
    │   ├── sms-assistant/    # Core texting behavior
    │   ├── contacts/         # Contacts.app management
    │   ├── hue/              # Philips Hue lights
    │   ├── sonos/            # Sonos speakers
    │   ├── lutron/           # Lutron Caseta dimmers/shades
    │   ├── memory/           # DuckDB memory store
    │   ├── reminders/        # macOS Reminders.app
    │   ├── tts/              # Text-to-speech (Google Cloud)
    │   ├── podcast/          # GCS podcast publishing
    │   ├── chrome-control/   # Browser automation
    │   ├── nano-banana/      # Image generation
    │   ├── airbnb/           # Airbnb search via Chrome
    │   ├── cooking/          # Recipe search + Instacart
    │   ├── books/            # Free ebook downloads
    │   ├── sheet-music/      # Piano sheet music finder
    │   ├── whatsnew/         # Reddit/X trending topics
    │   ├── chess/            # chess.com automation
    │   ├── axctl/            # macOS Accessibility CLI
    │   ├── md2pdf/           # Markdown to PDF conversion
    │   ├── notes-app/        # Apple Notes via AppleScript
    │   ├── screen-clicking/  # cliclick on Retina displays
    │   ├── system-info/      # Resource usage dashboard
    │   └── claude-assistant/ # Daemon/session management
    ├── secrets.env           # API keys (gitignored)
    └── CLAUDE.md             # Global instructions
```

## Appendix B: Example Conversation Flow
```
1. You text: "Turn off the living room lights" (via iMessage or Signal)
2. Daemon reads from chat.db (iMessage) or JSON-RPC socket (Signal)
3. Looks up your contact → tier: admin
4. Injects into your SDK session (creates if needed, resumes if interrupted)
5. Claude reads message, acknowledges with thumbs up
6. Runs: uv run hue/control.py off "Living Room"
7. Texts back: "Done"
```

## Appendix C: Security Considerations
- Never commit secrets.env
- Favorites can't read sensitive files
- Admin override tags only valid outside SMS blocks
- Payments require explicit text consent
- Owner's Chrome profile is read-only by default

---

## Conclusion

You now have a blueprint for building your own AI home assistant. The key insight isn't the technology - it's the philosophy: **ask what a human would do, then let Claude do that.**

Humans use Reminders, not cron. Humans use Contacts, not databases. Humans have email accounts and browse the web. Give Claude the same tools, and it becomes surprisingly capable.

Build your own. Customize it. Make it yours. That's the whole point.

---

*[Screenshots to be added: SDK session dashboard, Contacts tiers, Reminders lists, Chrome profiles, Signal integration]*
