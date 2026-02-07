# 12: Open Source Preparation

## Goal

Sanitize the codebase for public release - remove PII, credentials, and personal configuration while keeping the system functional.

## What to Remove

### Credentials & Secrets

| Type | Location | Action |
|------|----------|--------|
| API keys | `~/.claude/secrets.env` | Never commit, add to `.gitignore` |
| Hue tokens | `~/.hue/*.json` | Never commit |
| Lutron certs | `~/.config/pylutron_caseta/` | Never commit |
| Signal account | signal-cli config | Never commit |

### Personal Information

| Type | Example | Action |
|------|---------|--------|
| Phone numbers | `+16175551234` | Replace with `+1YOURNUMBER` |
| Email addresses | `john@gmail.com` | Replace with `your-email@example.com` |
| Contact names | `John Doe` | Replace with generic names |
| Home IPs | `10.10.10.23` | Document as "your bridge IP" |

### Hardcoded Paths

| Bad | Good |
|-----|------|
| `/Users/nicklaude/dispatch` | `~/dispatch` or `$HOME/dispatch` |
| `/Users/nicklaude/.claude` | `~/.claude` |

## File Structure for Public Repo

```
dispatch/
├── assistant/              # Core daemon (sanitized)
├── skills/                 # Skill modules (sanitized)
├── tests/                  # Test suite
├── docs/
│   └── blog/
│       └── bootstrap/      # These guides
├── launchd/
│   └── com.dispatch.assistant.plist.example
├── config.example.yaml     # Template config
├── pyproject.toml
├── README.md
├── LICENSE
└── .gitignore
```

## Configuration Files

### config.example.yaml

Create a template that users copy and customize:

```yaml
# Copy to config.local.yaml and fill in your values

assistant:
  name: "Assistant"

signal:
  account: "+1YOURNUMBER"

lutron:
  bridge_ip: "YOUR_BRIDGE_IP"

# etc.
```

### .gitignore

```gitignore
# Secrets
config.local.yaml
secrets.env
.env

# Credentials
.hue/
.config/pylutron_caseta/

# State
state/
logs/

# Python
.venv/
__pycache__/
*.pyc

# macOS
.DS_Store
```

## LaunchAgent Template

Rename plist to `.example` and use placeholders:

```xml
<!-- Copy to ~/Library/LaunchAgents/com.dispatch.assistant.plist -->
<!-- Replace YOUR_USERNAME with your actual username -->

<key>ProgramArguments</key>
<array>
    <string>/Users/YOUR_USERNAME/dispatch/bin/claude-assistant</string>
    <string>start</string>
</array>
```

## README Structure

```markdown
# Dispatch - Personal Assistant System

A daemon that turns your Mac into a personal assistant accessible via iMessage and Signal.

## Features
- Poll iMessage/Signal for incoming messages
- Route to Claude for processing
- Contact tier system (admin, family, favorite)
- Browser automation via Chrome extension
- Smart home control (Hue, Lutron, Sonos)

## Quick Start
1. Clone this repo
2. Follow `docs/blog/bootstrap/01-setup.md`
3. Give Claude the prompt from `02-claude-bootstrap.md`
4. Claude builds the rest

## Requirements
- macOS (for iMessage access)
- Anthropic API key
- Dedicated iCloud account (recommended)

## License
MIT
```

## Pre-Release Checklist

- [ ] All phone numbers replaced with placeholders
- [ ] All email addresses replaced with placeholders
- [ ] All API keys/tokens removed
- [ ] All hardcoded paths use `~` or `$HOME`
- [ ] `.gitignore` covers all secrets
- [ ] `config.example.yaml` created
- [ ] LaunchAgent has `.example` suffix
- [ ] README written
- [ ] LICENSE file added
- [ ] Tests pass without personal config
- [ ] Run `git log` to verify no PII in history

## Scrubbing Git History

If PII was committed historically:

```bash
# DANGEROUS: Rewrites history
# Use git-filter-repo (safer than filter-branch)
pip install git-filter-repo

# Remove a file from all history
git filter-repo --path secrets.env --invert-paths

# Force push (coordinate with collaborators)
git push --force
```

## Verification

Before publishing:

```bash
# Search for potential PII
grep -r "+1[0-9]\{10\}" .           # Phone numbers
grep -r "@gmail.com" .               # Emails
grep -r "/Users/" .                  # Hardcoded paths
grep -r "api_key\|token\|secret" .   # Credentials
```

## What's Next

Congratulations! You now have a complete personal assistant system that you can share with others.

---

## Gotchas

1. **Git history**: Even if you remove a file, it may exist in git history. Use `git filter-repo` to fully remove.

2. **Submodules**: If using submodules, check those repos too.

3. **Screenshots/docs**: Check any images or documentation for visible PII.

4. **Logs**: Never commit log files - they may contain message content.
