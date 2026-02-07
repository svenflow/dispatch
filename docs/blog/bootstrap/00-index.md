# Bootstrap: Recreating the Personal Assistant System

This folder contains ordered prompts to guide Claude in recreating the entire personal assistant system from scratch. Each file is a self-contained prompt that builds on the previous ones.

## Prerequisites

- A dedicated Mac (MacBook or Mac Mini)
- Willingness to create a separate iCloud account for the assistant
- Basic familiarity with command line

## Build Order

| # | File | What You Build |
|---|------|----------------|
| 01 | `01-setup.md` | Human setup (no Claude yet) - accounts, permissions, tools |
| 02 | `02-claude-bootstrap.md` | Hand off to Claude with the prompt to start |
| 03 | `03-messaging-core.md` | Daemon that polls iMessage and pipes to Claude |
| 04 | `04-contacts-tiers.md` | Contact lookup and permission tiers |
| 05 | `05-skills-system.md` | Skills folder structure, SKILL.md format |
| 06 | `06-session-management.md` | SDK sessions, resume, per-contact isolation |
| 07 | `07-browser-automation.md` | Chrome control extension |
| 08 | `08-smart-home.md` | Hue, Lutron, Sonos integrations |
| 09 | `09-signal-integration.md` | Adding Signal as second channel |
| 10 | `10-health-reliability.md` | Health checks, idle reaping, error recovery |
| 11 | `11-testing.md` | Test suite with FakeClaudeSDKClient |
| 12 | `12-open-source.md` | Sanitizing for public release |

## How to Use

1. **You (human)**: Complete `01-setup.md` manually
2. **You (human)**: Start Claude and give it the prompt from `02-claude-bootstrap.md`
3. **Claude**: Works through guides 03-12 autonomously

## Minimum Viable System

After Claude completes guides 03-04, you'll have:
- A daemon polling iMessage every 100ms
- Messages from approved contacts routed to Claude
- Claude responding via the send-sms CLI
- Basic tier-based access control

Everything after that is enhancement.
