---
name: sven-pages
description: Publish HTML folders with per-folder ACLs. Supports public access or email-based access control. Trigger words - deploy, pages, report, html hosting, publish.
---

# sven-pages

Publish HTML folders to Cloudflare with per-folder access control.

## Quick Start

```bash
# Publish a folder publicly (no auth required)
~/.claude/skills/sven-pages/scripts/publish ./my-report --public

# Publish with specific users allowed (requires Cloudflare Access)
~/.claude/skills/sven-pages/scripts/publish ./my-report --acl "alice@gmail.com,bob@gmail.com"

# List all published pages
~/.claude/skills/sven-pages/scripts/publish --list

# Update ACL for existing folder
~/.claude/skills/sven-pages/scripts/publish --set-acl my-report --acl "new-user@gmail.com"

# Make existing folder public
~/.claude/skills/sven-pages/scripts/publish --set-acl my-report --public

# Delete a folder
~/.claude/skills/sven-pages/scripts/publish --delete my-report
```

## Access Control

Each folder can have its own ACL:

- **Public (`--public`)**: Anyone with the URL can access
- **Email list (`--acl "a@x.com,b@x.com"`)**: Only listed emails can access (requires Cloudflare Access setup)
- **No ACL (default)**: Only admins can access

## Architecture

- **Worker**: `sven-pages-worker` on Cloudflare Workers
- **Storage**: Cloudflare KV namespace `SVEN_PAGES`
- **URL**: `https://sven-pages-worker.nicklaudethorat.workers.dev/{folder}/`

## For Group Chats

When publishing a report in a group chat, you can auto-share with participants:

```bash
# Get emails of group members, then publish with ACL
~/.claude/skills/sven-pages/scripts/publish ./report --acl "participant1@gmail.com,participant2@gmail.com"
```

## Admin Notes

The API key is stored at `~/.claude/skills/sven-pages/.api-key` and was set as a secret on the worker.

### Adding Google OAuth (Optional)

To enable Google login instead of email OTPs:

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth Client ID (Web application)
3. Add redirect URI: `https://your-team.cloudflareaccess.com/cdn-cgi/access/callback`
4. In Cloudflare Zero Trust > Settings > Authentication > Add new > Google
5. Paste client ID and secret

Then create an Access Application protecting the worker domain.

## Legacy Deploy Script

The old `deploy` script still works for simple Cloudflare Pages deployments (no ACLs):

```bash
~/.claude/skills/sven-pages/scripts/deploy ./folder
```
