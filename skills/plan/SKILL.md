---
name: plan
description: Create and manage sandboxed project plans. Trigger words - plan, make a plan, let's plan, planning.
---

# Plan Skill

Create and manage sandboxed project plans within transcript folders.

**TL;DR:**
- **Quick mode**: `plan create` → `plan update` with Goal + Steps → done
- **Full mode**: clarify → create with risks → derisk → review → iterate until 8/10
- **Always** use `plan update` to write PLAN.md (never Write tool directly)
- **Derisk** = actually test risky assumptions before building

## When to Use

When user wants to plan a project, feature, or complex task before implementation.

## Boundaries

**This skill does NOT:** use git, auto-review, track "current plan" state, generate code during planning, or sync remotely.

**Sandbox rules:** Only writes inside the plan folder. Never touches ~/code/, ~/dispatch/, or real projects during planning. Prototypes are disposable. Implementation begins only after user approves.

## Quick Mode vs Full Mode

Use **quick mode** if ALL of the following are true:
1. Estimated < 2 hours of work
2. No architectural decisions to make
3. No risky assumptions that could invalidate the approach
4. Single-person scope

If ANY is false, use **full mode**.

**Quick mode**: Just create → write Goal + Steps → done.

```bash
~/.claude/skills/plan/scripts/plan create "fix login redirect"
# Then plan update with Goal + Steps + Notes. No Derisking section. No clarifying questions.
```

**Full mode**: Clarifying questions → create plan with risks → derisk → review → iterate. See workflow below.

## Planning Workflow (Full Mode)

### 1. Ask Clarifying Questions

**In dispatch-app sessions**, use an `ask_question` widget:

```bash
cat <<'EOF' | ~/.claude/skills/dispatch-app/scripts/reply-widget "<chat_id>" ask_question
{"questions":[
  {"question":"What's the main goal?","options":[{"label":"New app","description":"Build from scratch"},{"label":"New feature","description":"Add to existing project"},{"label":"Refactor","description":"Improve existing code"},{"label":"Research","description":"Explore options"}]},
  {"question":"What's the scope?","options":[{"label":"Small","description":"A few hours"},{"label":"Medium","description":"A few days"},{"label":"Large","description":"A week+"}]}
]}
EOF
```

Customize questions based on context. 1-4 questions, 2-4 options each. "Other" text input included by default.

**In non-dispatch-app sessions** (iMessage, Signal), ask ALL questions in a SINGLE numbered message. Wait for all answers before proceeding.

### 2. Create Plan with Risks Identified

```bash
~/.claude/skills/plan/scripts/plan create "budget tracker app"
~/.claude/skills/plan/scripts/plan create "api migration" --template refactor
```

Then write initial content via `plan update` (step 3). Every full-mode plan includes:
- **Goal** — what we're building and why
- **Steps** — implementation checklist
- **Derisking** — assumptions to validate before building
- **Notes** — context, decisions, open questions

List assumptions in the Derisking section with status `untested`. A risk is **critical** if its failure would require a fundamental redesign of the approach. Non-critical risks are nice-to-validate but won't blow up the plan.

### 3. Always Use `plan update` to Write Changes

**CRITICAL: Never use the Write tool directly on PLAN.md. Always use `plan update`.** This auto-snapshots before every write (saves to `snapshots/vN.md`, bumps version, updates `LATEST.md` symlink).

```bash
cat << 'EOF' | ~/.claude/skills/plan/scripts/plan update "budget tracker app" --stdin
---
title: Budget Tracker App
version: 1
created: 2026-04-05T21:00:00
chat_id: +1XXXXXXXXXX
contact: Example User
backend: imessage
status: active
tags: [finance, personal]
implementation_path:
depends_on: []
last_review_score:
---

## Goal
Track household spending with auto-categorization from bank CSV exports.

## Steps
- [ ] Design data model (accounts, transactions, categories)
- [ ] Build CSV import pipeline for Chase, BofA, Amex
- [ ] Create categorization rules engine
- [ ] Build spending dashboard

## Derisking

| # | Risk | Critical | Status | Result |
|---|------|----------|--------|--------|
| 1 | Bank CSV formats parseable reliably | yes | untested | |
| 2 | SQLite handles our write volume | no | untested | |

### Derisk Details

#### DR-1: Bank CSV parsing
- **Hypothesis**: We can parse CSVs from Chase, BofA, and Amex reliably
- **Method**: Download sample CSVs from each bank, attempt parsing
- **Result**: (pending)
- **Verdict**: (pending)

#### DR-2: SQLite write volume
- **Hypothesis**: SQLite can handle ~100 transactions/day without issues
- **Method**: Benchmark 10k inserts to verify
- **Result**: (pending)
- **Verdict**: (pending)

## Notes
Starting with Chase since that's the primary account. Partner wants spending by category view.
EOF
```

### 4. Derisk Before Building

**Validate risky assumptions before iterating on the design.** This prevents building on false premises.

#### The Derisking Loop

1. **Pick the next untested risk** — prioritize critical risks first.

2. **Create a derisk file** — structured template for the experiment:

```bash
~/.claude/skills/plan/scripts/plan derisk "budget tracker app" "bank csv parsing"
# Creates: explorations/2026-04-05-derisk-bank-csv-parsing.md
# Pre-filled with: Hypothesis, Method, Result, Verdict sections
```

3. **Run the experiment** — actually test it (benchmark, prototype, API call, measure latency, etc.).

4. **Record results** — fill in the derisk file, then update the risk's status in PLAN.md via `plan update`:

| Status | Meaning |
|--------|---------|
| `untested` | Not yet tested (default) |
| `testing` | Currently running experiment |
| `validated` | Assumption confirmed true — safe to proceed |
| `busted` | Assumption wrong — plan needs revision |
| `mitigated` | Assumption uncertain or false, but plan adjusted to tolerate failure |

5. **If busted** — revise the plan's approach before continuing. Don't just note it — change the Steps/Goal.

6. **Stop derisking when** all critical risks have been tested (status is validated, busted, or mitigated — not untested/testing). After all critical risks are tested, proactively ask the user whether to proceed or revise before continuing.

#### What Makes a Good Risk

Testable and specific:
- **Performance**: "Can X handle Y ops/sec?" → benchmark it
- **Latency**: "Will this round-trip be < 200ms?" → measure it
- **Compatibility**: "Does library X work with Y?" → try it
- **Feasibility**: "Can the API do Z?" → call it
- **Scale**: "Will this work with 10k items?" → test with real data
- **Cost**: "What will this cost at scale?" → calculate it

Too vague (break these down first):
- "Users might not like it" → what specifically about the UX is uncertain?
- "It might be hard" → what operation might be slow/impossible?

#### `plan derisk` vs `plan explore`

Both create files in `explorations/`. Use `plan derisk` when there is a specific assumption that could bust the plan; use `plan explore` when there is no hypothesis to test.

- **`plan derisk "title" "risk"`** — targeted experiment to validate a specific assumption from the Derisking table. Creates `explorations/YYYY-MM-DD-derisk-{slug}.md` with structured Hypothesis → Method → Result → Verdict format.
- **`plan explore "title" "topic"`** — open-ended research or brainstorming (e.g., "what auth libraries exist?", "how does competitor X handle this?"). Creates `explorations/YYYY-MM-DD-{slug}.md` with free-form notes format.

### 5. Iterate with Review

After each significant revision, get a review score and share with the user.

**Step A: Run the review.** `plan review` prints the absolute path to PLAN.md — use `plan show` to get the content for the subagent prompt:

```bash
~/.claude/skills/plan/scripts/plan review "budget tracker app"
# Prints: path to PLAN.md + instructions
```

```python
plan_content = run("~/.claude/skills/plan/scripts/plan show 'budget tracker app'")

Agent(
    description="Review plan",
    model="sonnet",
    prompt=f"""Review this plan. Score on these 5 axes (1-10 each):
    1. Goal Clarity — is the goal specific and measurable?
    2. Step Completeness — are steps concrete, ordered, and sufficient?
    3. Derisking Quality — are critical risks identified, tested, and addressed?
    4. Feasibility — is this achievable with stated resources/timeline?
    5. Right-sized Complexity — simplest solution that fully works?

    Give overall average, top 3 recommendations.

    Plan content:
    {plan_content}"""
)
```

**Step B: Update the score.** After review, update `last_review_score` in PLAN.md frontmatter via `plan update`.

**Step C: Render and share.**

```bash
# Render to image
~/.claude/skills/md2img/scripts/md2img ~/transcripts/.../plans/budget-tracker-app/PLAN.md /tmp/plan.png -w 800

# Send to user (dispatch-app)
~/.claude/skills/dispatch-app/scripts/reply-app "<chat_id>" "Plan v2 — 7.2/10. Derisking CSV parsing next." --image /tmp/plan.png

# Send to user (iMessage)
~/.claude/skills/sms-assistant/scripts/send-sms "<chat_id>" "Plan v2 — 7.2/10." --image /tmp/plan.png
```

Always include: current score, brief status, what's next. Use the `chat_id` from the plan's frontmatter.

**Derisking affects reviews:** A plan with untested critical risks is not implementation-ready regardless of how polished the rest is.

If the review surfaces ambiguity, ask the user for clarification before proceeding. If the user rejects the plan entirely (not just refinements), return to step 1 with targeted clarifying questions about what changed.

### 6. Target Score for Implementation

Recommend implementation when ALL of the following are true:
- Plan reaches **8/10 or higher**
- **All critical risks** are validated or mitigated
- Any `busted` risks have been addressed (Steps/Goal revised to account for the finding)

User can override this threshold.

## Resuming a Plan

When returning to a plan after a session break:

```bash
~/.claude/skills/plan/scripts/plan show "budget tracker app"
```

Read the output and resume from the appropriate step:

| Plan state | Resume from |
|-----------|-------------|
| No Steps written yet | Step 2 (create initial content) |
| Steps exist but untested critical risks remain | Step 4 (derisking loop) |
| All critical risks tested, `last_review_score` empty or < 8 | Step 5 (review) |
| Score ≥ 8 and all critical risks validated/mitigated | Step 6 (recommend implementation) |
| Status is `implementing` | Post-Approval Handoff (continue building) |

## Post-Approval Handoff

When the user approves implementation:
1. Update plan status to `implementing` via `plan update`
2. Set `implementation_path` to the target code directory (e.g., `~/code/budget-tracker/`)
3. Reference the plan during implementation — it's the source of truth for what to build
4. Mark steps complete (`- [x]`) in the plan as you implement them
5. When done, update status to `completed`

**If a risk busts during implementation:** Pause implementation, update the plan with revised approach, and confirm the new scope with the user before continuing.

## Lifecycle: Status and Cleanup

Plan status values: `active` → `implementing` → `completed` (or `abandoned` at any point).

- **`abandoned`** — plan discarded but kept for reference. Use when: the plan has completed explorations, derisk files, or research that might be useful later.
- **`plan delete --force`** — permanently removes the plan folder. Use when: plan was created by mistake, is a duplicate, or has only an empty/skeleton PLAN.md with no useful content.

## Embedding Images

```bash
~/.claude/skills/plan/scripts/plan attach "budget tracker app" /path/to/screenshot.png
# Copies to: plans/budget-tracker-app/attachments/screenshot.png
```

Reference in PLAN.md: `![Description](./attachments/screenshot.png)`

Use when referencing external screenshots, wireframes, or data samples that can't be described in text.

Works with: local paths, remote URLs, base64 data URIs. Images render in PNG output via md2img.

## Frontmatter Fields

| Field | Purpose |
|-------|---------|
| `title` | Plan name |
| `version` | Auto-incremented on each `plan update` |
| `created` | ISO timestamp |
| `chat_id` | Contact phone/group ID |
| `contact` | Contact name |
| `backend` | imessage, signal, dispatch-app, etc. |
| `status` | active, implementing, completed, abandoned |
| `tags` | Freeform labels |
| `implementation_path` | Target code directory (set on approval) |
| `depends_on` | List of other plan titles this plan requires completed first. Informational only — not enforced by CLI, but check dependent plans are completed before starting implementation. |
| `last_review_score` | Most recent review score (e.g., 7.2) |

## CLI Reference

```bash
# Create a new plan
~/.claude/skills/plan/scripts/plan create "title"
~/.claude/skills/plan/scripts/plan create "title" --template app    # app|refactor|bug|research

# List and view
~/.claude/skills/plan/scripts/plan list
~/.claude/skills/plan/scripts/plan show "title"
~/.claude/skills/plan/scripts/plan templates

# Update content (ALWAYS use this, never Write tool directly)
cat << 'EOF' | ~/.claude/skills/plan/scripts/plan update "title" --stdin
(full PLAN.md content with frontmatter)
EOF
~/.claude/skills/plan/scripts/plan update "title" --file /tmp/plan-draft.md

# Targeted derisking (structured hypothesis/method/result/verdict)
~/.claude/skills/plan/scripts/plan derisk "title" "api latency"

# Open-ended exploration (free-form research notes)
~/.claude/skills/plan/scripts/plan explore "title" "auth options"

# Prototypes and attachments
~/.claude/skills/plan/scripts/plan prototype "title" "server.py"
~/.claude/skills/plan/scripts/plan attach "title" /path/to/file

# Versioning
~/.claude/skills/plan/scripts/plan snapshot "title"

# Review (prints plan path, then spawn subagent per step 5)
~/.claude/skills/plan/scripts/plan review "title"

# Search across all plans
~/.claude/skills/plan/scripts/plan search "query"

# Delete
~/.claude/skills/plan/scripts/plan delete "title"
~/.claude/skills/plan/scripts/plan delete "title" --force
```

## Plan Folder Structure

```
~/transcripts/{backend}/{chat_id}/plans/
└── budget-tracker-app/
    ├── PLAN.md
    ├── explorations/
    │   ├── 2026-04-05-derisk-csv-parsing.md
    │   └── 2026-04-06-auth-options.md
    ├── prototypes/
    ├── attachments/
    ├── snapshots/
    │   ├── v1.md
    │   └── LATEST.md -> v1.md
    └── reviews/
```

## PLAN.md Format

```yaml
---
title: Plan Title
version: 1
created: 2026-01-01T00:00:00
chat_id: +1XXXXXXXXXX
contact: Contact Name
backend: imessage
status: active
tags: []
implementation_path:
depends_on: []
last_review_score:
---

## Goal
What we're trying to achieve and why.

## Steps
- [ ] Step 1
- [ ] Step 2

## Derisking

| # | Risk | Critical | Status | Result |
|---|------|----------|--------|--------|
| 1 | Specific testable assumption | yes | untested | |

### Derisk Details

#### DR-1: Specific testable assumption
- **Hypothesis**: What we believe to be true
- **Method**: How we'll test it
- **Result**: (filled after testing)
- **Verdict**: (filled after testing — ✅ validated / ❌ busted / ⚠️ mitigated)

## Notes
Additional context, decisions, open questions.
```
