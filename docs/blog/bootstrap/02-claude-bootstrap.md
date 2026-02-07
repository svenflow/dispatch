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

First, make sure git is installed:
brew install git

Then clone the bootstrap guides:
git clone https://github.com/anthropics/dispatch.git ~/dispatch
cd ~/dispatch/docs/blog/bootstrap

Work through each guide in order, starting with 03-messaging-core.md.
For each guide:
1. Read it fully
2. Implement what it describes
3. Verify with the checklist at the end
4. Move to the next guide

Let's start with the messaging core daemon.
```

---

## What Happens Next

Claude will:
1. Fetch and read `03-messaging-core.md`
2. Create the poller that monitors `~/Library/Messages/chat.db`
3. Build the `send-sms` script
4. Wire them together

Then continue through each subsequent guide.

## Stopping Points

The system is useful at different stages:

| After Guide | You Have |
|-------------|----------|
| 03 | Basic daemon that can receive and respond to iMessages |
| 04 | Tier-based access control (only approved contacts) |
| 05 | Skills system for modular capabilities |
| 06 | Persistent sessions with memory |
| 07+ | Browser automation, smart home, Signal, etc. |

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
