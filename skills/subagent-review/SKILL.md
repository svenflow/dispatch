---
name: subagent-review
description: Review, rate, score, evaluate, or critique plans, code, designs using 5-axis rubric scoring. Trigger words - review, rate, score, evaluate, critique, feedback.
---

# Subagent Review

Use this skill when asked to review, rate, or evaluate something (plan, code, design, architecture, proposal, etc).

## How It Works

**Always spawn a subagent** for reviews. Never review directly - the separation ensures objectivity.

| Mode | When to Use | Axes |
|------|-------------|------|
| **Quick** | Simple content, internal docs, trivial fixes | 3-5 |
| **Deep** | Architecture, production code, important decisions | 5 (scored separately) |

**Default to Quick mode.** Use Deep mode when user says "thorough review", "deep review", or content is complex/high-stakes.

## Image Reviews

**For ANY image content (renders, designs, screenshots, etc.), ALWAYS call Gemini vision** - even in Quick mode. Images need visual understanding that Claude subagent can't provide.

```bash
# ALWAYS use for images, regardless of mode:
~/.claude/skills/gemini/scripts/gemini -m gemini-3-pro-image-preview -i [IMAGE] "[review prompt]"
# Fallback to gemini-2.5-flash-image if fails
```

## Web Search

**Optional but strongly encouraged.** Use web search to ground reviews in real-world practices:
- How do popular open source projects solve this?
- What are best practices and anti-patterns?
- What pitfalls have others encountered?

Skip web search only for trivial/internal content where industry patterns don't apply.

---

## Quick Start

**User:** "review this plan"

**You:** Spawn a Task:

```
Task(
    description="Review implementation plan",
    subagent_type="general-purpose",
    prompt="[prompt template] + [content]"
)
```

**Relay to user:** "7.4/10 - good feasibility, needs better completeness. Top rec: add error handling for X."

---

## Score Interpretation

| Score | Meaning |
|-------|---------|
| 9-10 | Excellent - production ready |
| 7-8 | Good - solid, minor improvements |
| 5-6 | Okay - works but has gaps |
| 3-4 | Weak - needs rework |
| 1-2 | Poor - fundamentally broken |

**7+ is passing.** Below 7 = material improvements needed.

---

## Prompt Template (Quick Mode)

```
You are a critical reviewer. Review the following [THING].

Your task:
1. Infer 3-5 axes most relevant to this [THING]
2. Score each axis 1-10 with brief justification
3. Compute average score
4. Give specific recommendations to improve each axis

IMPORTANT: One axis must ALWAYS be "Right-sized Complexity" - is this the simplest solution that fully works? Not over-engineered, not under-engineered.

RECOMMENDED: Use web search to research how others solve similar problems. Look for patterns in popular projects, best practices, and common pitfalls. Skip only for trivial/internal content.

Format:

## Review: [Brief title]

| Axis | Score | Justification |
|------|-------|---------------|
| ... | X/10 | [Why] |

**Average: X.X/10**

### Recommendations
1. **[Axis]**: [How to improve]
...

---

[CONTENT TO REVIEW]
```

---

## Prompt Template (Deep Mode)

For important reviews, score each axis separately for better accuracy.

**Deep mode has two reviewers:**
1. Claude subagent (primary reviewer)
2. Gemini (independent third-party observer)

### Step 1: Spawn Claude subagent

```
You are a critical reviewer doing a deep review. Review the following [THING].

STEP 1: Use web search to research similar patterns:
- How do popular open source projects solve this?
- What are best practices and anti-patterns?
- What pitfalls have others encountered?

STEP 2: Identify 5 axes most relevant to this [THING]. One MUST be "Right-sized Complexity".

STEP 3: For EACH axis separately:
- State the axis
- Think through how this content performs on this axis
- Assign a score 1-10
- Give specific improvement recommendation

STEP 4: Compute average and summarize.

Format:

## Deep Review: [Brief title]

### Research Context
[What you found from web search - 2-3 sentences]

### Axis 1: [Name]
**Analysis:** [Reasoning]
**Score:** X/10
**Recommendation:** [How to improve]

### Axis 2: [Name]
...

### Axis 5: Right-sized Complexity
**Analysis:** [Is this over/under engineered?]
**Score:** X/10
**Recommendation:** [How to simplify or complete]

---

**Average Score: X.X/10**

### Summary
[Key findings and top 2-3 recommendations]

---

[CONTENT TO REVIEW]
```

### Step 2: Call Gemini for independent review

Run in parallel with subagent (or after).

**Model priority:**
- Text reviews: `gemini-3-pro-preview` → fallback to `gemini-2.5-pro`
- Image reviews: `gemini-3-pro-image-preview` → fallback to `gemini-2.5-flash-image`

```bash
# For text content:
echo "[CONTENT TO REVIEW]" | ~/.claude/skills/gemini/scripts/gemini -m gemini-3-pro-preview "$(cat <<'EOF'
You are an independent reviewer providing a second opinion. Review the following content.

Score on 5 axes (1-10 each), one MUST be "Right-sized Complexity".
Be brief. Format:

| Axis | Score |
|------|-------|
| ... | X/10 |

**Average: X.X/10**

Top 3 recommendations:
1. ...
2. ...
3. ...
EOF
)"

# If gemini-3-pro-preview fails, retry with gemini-2.5-pro

# For image content:
~/.claude/skills/gemini/scripts/gemini -m gemini-3-pro-image-preview -i [IMAGE] "[prompt]"
# If fails, retry with -m gemini-2.5-flash-image
```

### Step 3: Synthesize both reviews

Report to user:
- **Claude subagent score:** X.X/10
- **Gemini score:** X.X/10
- **Combined average:** X.X/10
- Note any disagreements between reviewers
- Merge top recommendations from both

---

## Required Axis: Right-sized Complexity

Every review MUST include this axis. It measures:
- Over-engineered? Unnecessary abstraction?
- Under-engineered? Doesn't solve the full problem?
- Is this the simplest solution that fully works?

10/10 = exactly as complex as needed, no more, no less.

Low score could mean:
- "Adds 3 abstractions when 1 would do" (over)
- "Simple but doesn't handle [critical case]" (under)

---

## Example Axes by Context

**Code:** Correctness, Readability, Performance, Error Handling, **Right-sized Complexity**

**Architecture:** Feasibility, Scalability, Maintainability, Security, **Right-sized Complexity**

**Design:** Clarity, Completeness, User Impact, Technical Fit, **Right-sized Complexity**

**Feature spec:** User Value, Edge Cases, Integration Risk, Scope Clarity, **Right-sized Complexity**

---

## Handling Unclear Reviews

If subagent returns unhelpful/unclear review:

1. **Vague scores** → Ask for re-review with "Be more specific about what's missing"
2. **Missing context** → Provide more context in follow-up prompt
3. **Disagree with score** → Ask user if they want a second opinion (spawn another review)
4. **Conflicting recs** → Summarize the conflict, ask user to decide

---

## Edge Cases

**Content too large:** Break into chunks, review separately, average scores.

**Re-review after changes:** Include original score, ask if recommendations were addressed, compare before/after.

**Ambiguous content:** Ask user for clarification first.

**Trivial content:** Use 3 axes, Quick mode.

---

## Usage

Trigger phrases:
- "review this", "rate this", "score this out of 10"
- "evaluate this", "critique this", "get feedback on"
- "deep review" → use Deep mode

Spawn Task with `subagent_type: "general-purpose"`, include prompt template + content.

Relay response as: condensed table + average score + top 2-3 recommendations.
