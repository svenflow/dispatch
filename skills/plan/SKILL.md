---
name: plan
description: Create and manage sandboxed project plans. Trigger words - plan, make a plan, let's plan, planning.
---

# Plan Skill

Create and manage sandboxed project plans within transcript folders. Plans live alongside conversations, contain explorations and throwaway prototypes, and never touch real code until explicitly approved.

## When to Use

When user wants to plan a project, feature, or complex task before implementation.

## Planning Workflow

### 1. Ask Clarifying Questions First

Before creating a plan, ask clarifying questions to understand:
- What's the main goal?
- Any constraints or requirements?
- Who's the audience/user?
- What's the scope?

**IMPORTANT:** Send each question as a SEPARATE message so user can reply to specific ones.

### 2. Create Initial Plan

After getting answers, create the plan:
```bash
~/.claude/skills/plan/scripts/plan create "title"
# or with template:
~/.claude/skills/plan/scripts/plan create "title" --template app
```

Edit PLAN.md to fill in goal, steps, and notes based on user's answers.

### 3. Iterate with Review

After each significant revision:
1. Run subagent-review: `~/.claude/skills/plan/scripts/plan review "title"`
2. Render the plan as an image and attach to message
3. Include brief text summary with score and key feedback

**IMPORTANT: Always attach the rendered plan image when sharing with user.**

```bash
# Render plan to image
~/.claude/skills/md2img/scripts/md2img /path/to/PLAN.md /tmp/plan.png

# Send with image attachment
~/.claude/skills/sms-assistant/scripts/send-sms "chat_id" "message" --image /tmp/plan.png
```

Example workflow:
```bash
# Get plan path
PLAN_PATH=$(~/.claude/skills/plan/scripts/plan show "title" | head -1)
# Render to image
~/.claude/skills/md2img/scripts/md2img "$PLAN_PATH" /tmp/plan.png -w 800
# Send with attachment
reply "Updated plan (v2, score 7/10). Addressing auth flow next." --image /tmp/plan.png
```

The image lets the user see the full formatted plan at a glance. Always include:
- Current score
- Brief status update
- What you're working on next

### 4. Ask More Questions If Needed

If the review surfaces ambiguity or unclear areas, ask the user for clarification before proceeding.

### 5. Target Score for Implementation

Recommend implementation when plan reaches 8/10 or higher. User can override this threshold.

## Sandbox Rules

1. Planning mode ONLY writes inside the plan folder
2. Never touch ~/code/, ~/dispatch/, or any real project
3. Prototypes in the plan folder are explicitly disposable
4. Real implementation begins only after user approves

## CLI Commands

All commands require explicit plan title - no "current plan" state.

```bash
# Core
plan create "title" [--template app|refactor|bug|research]
plan list                     # plans in current transcript
plan show "title"             # display PLAN.md
plan edit "title"             # open in $EDITOR
plan delete "title"           # remove plan (with confirmation)

# Templates
plan templates                # list available templates

# Exploration
plan explore "title" "topic"  # create explorations/YYYY-MM-DD-topic.md
plan prototype "title" "file" # create prototypes/file
plan attach "title" "file"    # copy file to attachments/

# Versioning
plan snapshot "title" "desc"  # copy PLAN.md to snapshots/vN.md

# Review
plan review "title"           # run subagent-review, save to reviews/

# Search
plan search "query"           # rg across all plans
```

## Plan Folder Structure

```
~/transcripts/{backend}/{chat_id}/
├── plans/
│   ├── budget-tracker-app/
│   │   ├── PLAN.md
│   │   ├── explorations/
│   │   ├── prototypes/
│   │   ├── attachments/
│   │   ├── snapshots/
│   │   └── reviews/
│   └── ...
└── ...
```

## PLAN.md Format

```yaml
---
title: Budget Tracker App
version: 1
created: 2026-02-23T20:12:00
chat_id: +1XXXXXXXXXX
contact: Example User
backend: imessage
status: active
tags: []
implementation_path:
depends_on: []
last_review_score:
---

## Goal
What we're trying to achieve.

## Steps
- [ ] Step 1
- [ ] Step 2

## Notes
Additional context, decisions, open questions.
```

## What This Skill Does NOT Do

- No git (PII in transcripts)
- No auto-review (on-demand only)
- No "current plan" state management
- No automatic code generation
- No remote sync
