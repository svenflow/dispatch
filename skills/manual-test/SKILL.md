---
name: manual-test
description: Manual testing orchestrator. Enumerate CUJs for any feature, execute via browser or API, report results. Trigger words - manual test, test, CUJ, test feature, verify, QA.
---

# /manual-test — Manual Testing Skill

**Purpose:** Enumerate CUJs for a feature, execute them via browser or API, report results. Wraps chrome-control and curl.

## Invocation

```
/manual-test                        # auto-detect mode, enumerate CUJs
/manual-test web                    # browser testing via chrome-control
/manual-test api                    # API testing via curl
/manual-test smoke                  # top 3-5 CUJs only
/manual-test run <name>             # load saved CUJs, confirm, execute
/manual-test list                   # list saved CUJ sets in .manual-test/
```

## Step 0: Preflight

- Web: `chrome list-tabs` succeeds. API: health endpoint returns 200.
- Fails → print fix → STOP
- Create `/tmp/manual-test/run-{timestamp}/` for screenshots (`cuj-N-before.png`, `cuj-N-after.png`) and `results.json`

## Step 1: Enumerate CUJs

*`run <name>`: load from `.manual-test/<name>.json` (project root), show list, confirm before executing.*

**Discovery:**
1. `git diff --name-only` → changed files
2. Grep changed files for route/handler registrations and exported components (patterns vary by framework — Express routes, Next.js pages, React Navigation screens, Django urlpatterns, Flask routes, etc.)
3. Target 3-15 CUJs, prioritized by code churn. Include at least 1 error-path CUJ for every 2-3 happy paths.
4. Check adjacent test files — extract CUJs from existing tests when available
5. If no changed files or context, ask user what to test

**Auth:**
- If app has auth, insert CUJ 0 "Establish session"
- Ask user: (a) log in via UI, (b) assume active session, (c) provide token
- API mode: option (c) is the default; prompt if no `Authorization` header is obvious from the codebase
- Auth is shared across CUJs. If 401 mid-run, pause and re-prompt user

**CUJ format (Arrange-Act-Assert):**
```
CUJ 3: Send a message
ARRANGE: Navigate to /chat/123, ensure input bar visible
ACT: Type "hello" → click send
ASSERT:
  - DOM: input.value === ''
  - Visual: user bubble appears on right [opt-in]
```

- **DOM** (default): `chrome execute` returning boolean. Deterministic.
- **Visual** (opt-in per CUJ during Step 1 confirmation, ~90% reliable): LLM reads screenshot. Lower confidence — flagged in report.
- CUJs are independent (except shared auth).

**User commands:**
- `run all` — execute all CUJs
- `run 1,3,5` — execute specific CUJs
- `skip 2` — exclude specific CUJs
- `edit 3` — describe change → rewrite → confirm
- `save <name>` — write to `.manual-test/<name>.json` (project root, overwrites if exists)
- `abort` — stop execution

## Step 2: Execute

Real-time progress: `CUJ 1/6: Create chat... ✅ PASS (2.1s)`

**State cleanup (web):** Reload page at start of each CUJ's ARRANGE (fresh DOM, preserves auth cookies).

**Web mode per CUJ:**
1. Navigate to URL (ARRANGE) → screenshot "before"
2. Click/type (ACT)
3. Wait for DOM readiness (poll for expected element, default ~10s timeout; extend for slow operations like file uploads)
4. DOM assertions via `chrome execute`
5. Screenshot "after"
6. Visual assertions if opted-in: Read screenshot → evaluate

**API mode per CUJ:** Preconditions (ARRANGE) → `curl` (ACT) → assert status + body (ASSERT)

### Status Rules

| Status | When | Example |
|--------|------|---------|
| ✅ PASS | All assertions met | DOM check passed, visual confirmed |
| ❌ FAIL | Any assertion not met | input.value wasn't empty |
| ⚠️ REVIEW | Ambiguous, needs human judgment | DOM/visual disagree, visual-only uncertain |
| 🔧 ERROR | Couldn't run the CUJ | Server down, ARRANGE 404, chrome crashed, timed out |

ERROR includes a `reason`: `env` (server/chrome down), `setup` (ARRANGE failed), `tool` (chrome command crashed), `timeout`.

**Guardrails:**
- Health check between web CUJs (`chrome list-tabs`)
- 2 consecutive ERRORs with reason `setup` → pause, ask user if environment is correct
- Auth 401 mid-run → pause, re-prompt
- Abort = finish current CUJ, stop, partial report

## Step 3: Report

```
## Test Results: [Feature]
Mode: web | Run: 2026-03-22T21:50 | 6/6 | ✅ 4 | ❌ 1 | ⚠️ 1 | 🔧 0

| # | CUJ | Type | Status | Evidence |
|---|-----|------|--------|----------|
| 1 | Create chat | dom | ✅ | cuj-1-after.png |
| 2 | Send message | dom+visual | ❌ | cuj-2-after.png |
| 3 | Color hover | visual-only | ⚠️ | cuj-3-after.png |
| 4 | Offline mode | dom | 🔧 | — (setup: server unreachable) |

### Failures
**CUJ 2: Send message**
- DOM: FAIL — input.value="hello" (expected "")
- Suggested fix: onSubmit in InputBar.tsx

### Needs Review [visual-only, lower confidence]
**CUJ 3: Color hover**
- Visual: UNCERTAIN — may be mid-animation

### Errors
**CUJ 4: Offline mode**
- Reason: setup — server became unreachable during ARRANGE
```

**Machine-readable:** `/tmp/manual-test/run-{timestamp}/results.json` — includes per-CUJ status, timing, evidence paths, and error reasons (`schema_version: 1`).

## Smoke Mode

Top CUJs: (1) primary happy path, (2) highest code churn, (3) error handling. Cap at 5.

## Scope

Web + API only. iOS → /ios-app, real devices → /lambdatest, perf → /latency-finder, code → /bug-finder.
