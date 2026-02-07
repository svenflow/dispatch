# 02: Claude Bootstrap (Hand Off to Claude)

## Goal

You've completed the human setup. Now start Claude and hand it the rest of the bootstrap guides.

## The Handoff

Open your terminal and start Claude:

```bash
claude
```

Then give Claude this prompt:

---

**Prompt to give Claude:**

```
I want to build a personal assistant system that:
- Polls iMessage for incoming messages
- Routes them to you (Claude) for processing
- Lets you respond via send-sms CLI
- Has contact tiers (admin, family, favorite, etc.)
- Supports browser automation, smart home, and more

First, make sure git and gh (GitHub CLI) are installed:
brew install git gh
gh auth login

Then clone the repo:
gh repo clone nicklaude/dispatch ~/dispatch
cd ~/dispatch/docs/blog/bootstrap

Work through each guide in order, starting with 03-identity-setup.md.
For each guide:
1. Read it fully
2. Implement what it describes
3. Verify with the checklist at the end
4. Move to the next guide

Let's start with identity setup.
```

---

## What Happens Next

Claude will:
1. Fetch and read `03-identity-setup.md`
2. Ask you for your identity info (name, phone, etc.)
3. Create `config.local.yaml`
4. Continue to messaging core and beyond

Then continue through each subsequent guide.

## Stopping Points

The system is useful at different stages:

| After Guide | You Have |
|-------------|----------|
| 03 | Identity configured (config.local.yaml) |
| 04 | Basic daemon that can receive and respond to iMessages |
| 05 | Tier-based access control (only approved contacts) |
| 06 | Skills system for modular capabilities |
| 07 | Persistent sessions with memory |
| 08+ | Browser automation, smart home, Signal, etc. |

You can stop at any point and have a working system.

## Tips

- Let Claude work autonomously - it has the guides
- Check in after each guide completes
- If something breaks, Claude can debug using the verification checklists
- The guides are designed to be self-contained

## Why This Works

The bootstrap guides contain:
- Exact code to implement
- Architecture decisions already made
- Gotchas and edge cases documented
- Verification steps to confirm success

Claude doesn't need to figure out the architecture - it just follows the guides.
