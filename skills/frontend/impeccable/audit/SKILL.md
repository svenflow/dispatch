---
name: audit
description: Perform comprehensive audit of interface quality across accessibility, performance, theming, and responsive design. Generates detailed report of issues with severity ratings and recommendations.
user-invokable: true
args:
  - name: area
    description: The feature or area to audit (optional)
    required: false
---

Run systematic quality checks and generate a comprehensive audit report with prioritized issues and actionable recommendations. Don't fix issues - document them for other commands to address.

**First**: Use the frontend-design skill for design principles and anti-patterns.

## Diagnostic Scan

Run comprehensive checks across multiple dimensions:

1. **Accessibility (A11y)** - Check for:
   - **Contrast issues**: Text contrast ratios < 4.5:1 (or 7:1 for AAA)
   - **Missing ARIA**: Interactive elements without proper roles, labels, or states
   - **Keyboard navigation**: Missing focus indicators, illogical tab order, keyboard traps
   - **Semantic HTML**: Improper heading hierarchy, missing landmarks, divs instead of buttons
   - **Alt text**: Missing or poor image descriptions
   - **Form issues**: Inputs without labels, poor error messaging, missing required indicators

2. **Performance** - Check for:
   - **Layout thrashing**: Reading/writing layout properties in loops
   - **Expensive animations**: Animating layout properties (width, height, top, left) instead of transform/opacity
   - **Missing optimization**: Images without lazy loading, unoptimized assets, missing will-change
   - **Bundle size**: Unnecessary imports, unused dependencies
   - **Render performance**: Unnecessary re-renders, missing memoization

3. **Theming** - Check for:
   - **Hard-coded colors**: Colors not using design tokens
   - **Broken dark mode**: Missing dark mode variants, poor contrast in dark theme
   - **Inconsistent tokens**: Using wrong tokens, mixing token types
   - **Theme switching issues**: Values that don't update on theme change

4. **Responsive Design** - Check for:
   - **Fixed widths**: Hard-coded widths that break on mobile
   - **Touch targets**: Interactive elements < 44x44px
   - **Horizontal scroll**: Content overflow on narrow viewports
   - **Text scaling**: Layouts that break when text size increases
   - **Missing breakpoints**: No mobile/tablet variants

5. **Anti-Patterns (CRITICAL)** - Check against ALL the **DON'T** guidelines in the frontend-design skill. Look for AI slop tells (AI color palette, gradient text, glassmorphism, hero metrics, card grids, generic fonts) and general design anti-patterns (gray on color, nested cards, bounce easing, redundant copy).

**CRITICAL**: This is an audit, not a fix. Document issues thoroughly with clear explanations of impact. Use other commands (normalize, optimize, harden, etc.) to fix issues after audit.

## Generate Comprehensive Report

Create a detailed audit report with the following structure:

### Anti-Patterns Verdict
**Start here.** Pass/fail: Does this look AI-generated? List specific tells from the skill's Anti-Patterns section. Be brutally honest.

### Executive Summary
- Total issues found (count by severity)
- Most critical issues (top 3-5)
- Overall quality score (if applicable)
- Recommended next steps

### Detailed Findings by Severity

For each issue, document:
- **Location**: Where the issue occurs (component, file, line)
- **Severity**: Critical / High / Medium / Low
- **Category**: Accessibility / Performance / Theming / Responsive
- **Description**: What the issue is
- **Impact**: How it affects users
- **WCAG/Standard**: Which standard it violates (if applicable)
- **Recommendation**: How to fix it
- **Suggested command**: Which command to use (e.g., `/normalize`, `/optimize`, `/harden`)

#### Critical Issues
[Issues that block core functionality or violate WCAG A]

#### High-Severity Issues  
[Significant usability/accessibility impact, WCAG AA violations]

#### Medium-Severity Issues
[Quality issues, WCAG AAA violations, performance concerns]

#### Low-Severity Issues
[Minor inconsistencies, optimization opportunities]

### Patterns & Systemic Issues

Identify recurring problems:
- "Hard-coded colors appear in 15+ components, should use design tokens"
- "Touch targets consistently too small (<44px) throughout mobile experience"
- "Missing focus indicators on all custom interactive components"

### Positive Findings

Note what's working well:
- Good practices to maintain
- Exemplary implementations to replicate elsewhere

### Recommendations by Priority

Create actionable plan:
1. **Immediate**: Critical blockers to fix first
2. **Short-term**: High-severity issues (this sprint)
3. **Medium-term**: Quality improvements (next sprint)
4. **Long-term**: Nice-to-haves and optimizations

### Suggested Commands for Fixes

Map issues to appropriate commands:
- "Use `/normalize` to align components with design system (addresses 23 theming issues)"
- "Use `/optimize` to improve performance (addresses 12 performance issues)"
- "Use `/harden` to improve i18n and text handling (addresses 8 edge cases)"

**IMPORTANT**: Be thorough but actionable. Too many low-priority issues creates noise. Focus on what actually matters.

**NEVER**:
- Report issues without explaining impact (why does this matter?)
- Mix severity levels inconsistently
- Skip positive findings (celebrate what works)
- Provide generic recommendations (be specific and actionable)
- Forget to prioritize (everything can't be critical)
- Report false positives without verification

Remember: You're a quality auditor with exceptional attention to detail. Document systematically, prioritize ruthlessly, and provide clear paths to improvement. A good audit makes fixing easy.
## DESIGN.md Compliance (When Active)

When `./DESIGN.md` exists in the project root, add a **6th audit dimension** — Design System Compliance:

### 6. Design System Compliance

Check the codebase against the active DESIGN.md. Use a **two-tier severity model**:

**Violations** (must fix — blocks `/polish`):
- Wrong font family (e.g., using Inter when DESIGN.md specifies Geist)
- Color clearly outside the defined palette
- Pattern explicitly listed in the DESIGN.md's "Don'ts" section

**Warnings** (advisory — doesn't block `/polish`):
- Border-radius slightly off the defined scale
- Shadow approach different but not explicitly forbidden
- Spacing not matching the base unit exactly

**Checks to run:**
- **Palette compliance**: Are all colors in the codebase found in the DESIGN.md palette?
- **Font families**: Do heading/body/mono fonts match the DESIGN.md spec?
- **Border-radius scale**: Do radius values match the system's defined scale?
- **Shadow approach**: Does the shadow system match (e.g., ring shadows vs drop shadows)?
- **Do's and Don'ts**: Are the explicit guidelines from section 7 respected?
- **Responsive breakpoints**: If the DESIGN.md defines breakpoints, are they followed?

### design-audit.json

When DESIGN.md compliance checks are run, write results to `./design-audit.json`:

```json
{
  "audited_at": "2026-04-05T11:30:00Z",
  "violations": 2,
  "warnings": 3,
  "details": [
    "VIOLATION: Wrong font family - using Inter, DESIGN.md specifies Geist",
    "VIOLATION: Off-palette color #ff0000 not in design system",
    "WARNING: Button radius 12px, design system specifies 8px",
    "WARNING: Using drop shadow, design system prefers ring shadows",
    "WARNING: Spacing 20px not on 8px base grid"
  ]
}
```

This file is **gitignored** (ephemeral build artifact). `/polish` reads it to gate the polish step — violations must be fixed before polish can proceed.

**If no `./DESIGN.md` exists**, skip this entire section. Only the standard 5 audit dimensions apply.
