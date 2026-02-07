# Bootstrap: Recreating the Personal Assistant System

This folder contains ordered prompts to guide Claude in recreating the entire personal assistant system from scratch. Each file is a self-contained prompt that builds on the previous ones.

## Prerequisites

- A dedicated Mac (MacBook or Mac Mini)
- Willingness to create a separate iCloud account for the assistant
- Basic familiarity with command line

## Build Order

| # | File | What You Build |
|---|------|----------------|
| 01 | `01-setup.md` | Machine setup, accounts, permissions |
| 02 | `02-messaging-core.md` | Daemon that polls iMessage and pipes to Claude |
| 03 | `03-contacts-tiers.md` | Contact lookup and permission tiers |
| 04 | `04-skills-system.md` | Skills folder structure, SKILL.md format |
| 05 | `05-session-management.md` | SDK sessions, resume, per-contact isolation |
| 06 | `06-browser-automation.md` | Chrome control extension |
| 07 | `07-smart-home.md` | Hue, Lutron, Sonos integrations |
| 08 | `08-signal-integration.md` | Adding Signal as second channel |
| 09 | `09-health-reliability.md` | Health checks, idle reaping, error recovery |
| 10 | `10-testing.md` | Test suite with FakeClaudeSDKClient |
| 11 | `11-open-source.md` | Sanitizing for public release |

## How to Use

1. Start with `00-setup.md` and complete it fully
2. Move to the next file only when the previous is working
3. Each file has verification steps - don't skip them
4. The system is designed to be useful at each stage (you can stop at 03 and have a working assistant)

## Minimum Viable System

After completing files 00-03, you'll have:
- A daemon polling iMessage every 100ms
- Messages from approved contacts routed to Claude
- Claude responding via the send-sms CLI
- Basic tier-based access control

Everything after that is enhancement.
