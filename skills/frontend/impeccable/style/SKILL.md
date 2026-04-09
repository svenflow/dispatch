---
name: style
description: Load a DESIGN.md as the active design system. Overrides default visual language. Trigger words - style, design system, design-md, brand style, look like.
---

# /style — Load a Design System

Load a DESIGN.md from the curated cache or from the project itself. When active, the DESIGN.md becomes the **sole design authority**, overriding the skill's default visual language (Manrope, cream, orange, sharp corners).

## Usage

- `/style <name>` — Load a named design system (e.g., `/style linear`, `/style stripe`)
- `/style custom` — Use the existing `./DESIGN.md` in the project root
- `/style list` — Show available design systems in the cache
- `/style clear` — Remove DESIGN.md, design-tokens.css, and design-audit.json. Revert to default visual language.

## Behavior: /style \<name\>

1. Resolve the name to a DESIGN.md path:
   ```bash
   ~/.claude/skills/frontend/scripts/resolve-design <name>
   ```
   This handles exact matches and common domain suffixes (`.app`, `.ai`, `.com`, `.dev`, `.io`) automatically. Priority: exact match first, then suffixes in listed order.
   If it fails, relay the error message to the user.
2. Copy the DESIGN.md to `./DESIGN.md` in the project root
   - If `./DESIGN.md` already exists, **overwrite without confirmation** (imperative command)
3. Read the DESIGN.md completely
4. Extract design tokens into `./design-tokens.css`:

**Token extraction instructions** — use ONLY variable names from `./impeccable/style/canonical-tokens.txt` (prefixed with `--`):

```
Extract design tokens from the DESIGN.md into CSS custom properties using
EXACTLY these variable names. If a concept is absent, omit the variable.
Do not invent values or create variables outside this list.

:root {
  --color-primary: ...;          /* brand/accent color */
  --color-primary-hover: ...;    /* accent hover state */
  --color-bg: ...;               /* page background */
  --color-bg-surface: ...;       /* card/elevated surface */
  --color-bg-elevated: ...;      /* higher elevation surface */
  --color-text-primary: ...;     /* primary text */
  --color-text-secondary: ...;   /* secondary text */
  --color-text-tertiary: ...;    /* muted/disabled text */
  --color-border: ...;           /* standard border */
  --color-border-subtle: ...;    /* subtle/whisper border */
  --font-heading: ...;           /* headline font-family with fallbacks */
  --font-body: ...;              /* body font-family with fallbacks */
  --font-mono: ...;              /* monospace font-family with fallbacks */
  --radius-sm: ...;              /* small elements */
  --radius-md: ...;              /* standard cards/buttons */
  --radius-lg: ...;              /* large containers */
  --radius-pill: ...;            /* pill/full round */
  --shadow-sm: ...;              /* subtle elevation */
  --shadow-md: ...;              /* medium elevation */
  --shadow-lg: ...;              /* prominent elevation */
  --spacing-base: ...;           /* base spacing unit */
}
```

5. Run `~/.claude/skills/frontend/scripts/validate-tokens ./design-tokens.css`
   - This deterministically strips any non-canonical variables
   - If threshold fails (no color AND no font tokens, OR fewer than 5 canonical tokens):
     - Report: "Token extraction failed — only N tokens extracted from [Name] DESIGN.md. The DESIGN.md may use an unusual format. Try `/style custom` with a manually written DESIGN.md."
     - Do NOT proceed to build. The extraction quality is too low.
6. Report to user:
   ```
   Loaded [Name] design system.
   Extracted [N] canonical tokens → ./design-tokens.css
   [Removed M non-canonical variables: --var1, --var2]  (if any were stripped)
   Ready to build.
   ```

## Behavior: /style custom

1. Check for `./DESIGN.md` — if not found, offer scaffolding:
   ```
   No DESIGN.md in project root.
   - Use `/style <name>` to load one from the cache
   - Or create a minimal DESIGN.md with these sections:
     ## 1. Visual Theme & Atmosphere
     ## 2. Color Palette & Roles
     ## 3. Typography Rules
     ## 4. Spacing & Layout
     ## 5. Component Patterns
   ```
2. Read `./DESIGN.md`
3. Extract tokens and validate (steps 4-6 above)

## Behavior: /style list

List subdirectories of `~/.claude/skills/frontend/design-md/design-md/` alphabetically:

```bash
ls -1 ~/.claude/skills/frontend/design-md/design-md/ | sort | tr '\n' ',' | sed 's/,$/\n/'
```

Output format:
```
Available design systems:
airtable, airbnb, apple, bmw, cal, claude, ...

Usage: /style <name>
```

No hardcoded categories or counts. Dynamic from cache directory.

## Behavior: /style clear

Remove `./DESIGN.md`, `./design-tokens.css`, and `./design-audit.json` from the project root. Report: "Design system cleared. Reverted to default visual language."

## Design Authority

When DESIGN.md is active (file exists in project root):

1. **It is the SOLE design authority.** Default Manrope/cream/orange/sharp-corners are suspended.
2. **All impeccable commands evaluate against it.** `/audit`, `/polish`, `/colorize`, `/bolder`, `/quieter`, `/animate` — all respect the active DESIGN.md.
3. **The Impeccable Loop anti-pattern rules still apply.** DESIGN.md doesn't exempt code from the AI slop test. But if the chosen DESIGN.md legitimately uses a pattern (e.g., Linear uses Inter), that's intentional, not slop.

**Creative command constraints when DESIGN.md is active:**
- `/colorize`: Propose variations only within the loaded palette — do not introduce off-palette colors
- `/bolder` / `/quieter`: Adjust intensity within the design language
- `/animate`: If the DESIGN.md defines a motion philosophy, respect it. If not, default to `prefers-reduced-motion`-safe transitions under 300ms — do not invent a motion identity.

## Degradation Rules

- **Incomplete DESIGN.md** (missing sections): Treat missing sections as unconstrained. Proceed with what's defined. Never silently fall back to default visual language.
- **Empty/malformed DESIGN.md** (no actionable tokens): Warn: "DESIGN.md found but no design tokens extracted. Proceeding without design constraints — run `/style clear` to deactivate or add token definitions."
- **Below-threshold extraction**: If `design-tokens.css` has no `--color-*` AND no `--font-*` variable, warn as malformed.
- **Orphaned design-tokens.css** (exists without DESIGN.md): Warn: "Found design-tokens.css without DESIGN.md — tokens file is orphaned. Run `/style clear` to clean up or restore a DESIGN.md."

## File Lifecycle

| File | Location | Created by | Removed by | Status |
|------|----------|------------|------------|--------|
| `DESIGN.md` | `./DESIGN.md` | `/style <name>` or user | `/style clear` | Committed |
| `design-tokens.css` | `./design-tokens.css` | `/style` extraction | `/style clear` | Committed |
| `design-audit.json` | `./design-audit.json` | `/audit` | `/style clear` or `/audit` overwrite | Gitignored, stale after code changes |

**Copy-on-load semantics:** `/style <name>` copies the DESIGN.md into the project. The copy is standalone — cache updates don't affect active projects.

**Audit invalidation:** Any `/style` subcommand that writes `design-tokens.css` (i.e., `/style <name>` or `/style custom`) invalidates the existing `design-audit.json` by modifying tokens. The `/polish` staleness check detects this automatically via mtime comparison. After loading or reloading a style, `/audit` must run before `/polish` can proceed.

## Canonical Tokens

The canonical token list lives in `./impeccable/style/canonical-tokens.txt`. This is the **single source of truth** — the `validate-tokens` script and the extraction prompt both reference it. To add a new canonical token, edit this one file.
