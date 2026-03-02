---
name: skill-finder
description: Search and discover agent skills from skills.sh marketplace (80K+ skills) and skillsmp.com (280K+ skills). Use when looking for new capabilities, browsing trending skills, or researching what skills exist. Trigger words - find skill, search skills, skill marketplace, skills.sh, discover skills, trending skills.
---

# Skill Finder

Search and discover skills from the open SKILL.md ecosystem. Search-only - shows what's available, doesn't install.

## Quick Start

```bash
# Search for skills
~/.claude/skills/skill-finder/scripts/find-skill "web scraping"

# Browse trending skills
~/.claude/skills/skill-finder/scripts/find-skill --trending
```

## Usage

### Search for Skills

```bash
# Basic search
~/.claude/skills/skill-finder/scripts/find-skill "your query"

# Examples
~/.claude/skills/skill-finder/scripts/find-skill "react best practices"
~/.claude/skills/skill-finder/scripts/find-skill "code review"
~/.claude/skills/skill-finder/scripts/find-skill "testing automation"
```

### Browse Trending/Popular

```bash
# Show trending skills (last 24h)
~/.claude/skills/skill-finder/scripts/find-skill --trending

# Show all-time top skills
~/.claude/skills/skill-finder/scripts/find-skill --top
```

## Sources

- **skills.sh** - The official open agent skills ecosystem (80K+ skills)
  - Leaderboard, trending, search
  - CLI: `npx skills find`

- **skillsmp.com** - Agent Skills Marketplace (280K+ indexed from GitHub)
  - AI-powered semantic search (requires login)
  - Categories and popularity sorting

## How It Works

The `find-skill` CLI wraps `npx skills find` which searches the skills.sh registry. Results show:
- Skill name and repo
- Install count
- Direct link to skill page on skills.sh

## Examples

### Finding React Skills
```
$ find-skill "react hooks"
vercel-labs/agent-skills@vercel-react-best-practices  179.9K installs
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices

mindrally/skills@react-component-design  12.3K installs
└ https://skills.sh/mindrally/skills/react-component-design
```

### Browsing Leaderboard
```
$ find-skill --trending
📊 Skills Leaderboard (trending):

Top skills by installs (from skills.sh):
  1. find-skills (vercel-labs/skills) - 365K+ installs
  2. vercel-react-best-practices - 180K+ installs
  ...
```
