---
name: figma
description: Access Figma designs via MCP or Chrome. Use when asked about Figma files, design mockups, wireframes, or UI designs. Trigger words - figma, design, mockup, wireframe, UI design, FigJam.
---

# Figma Skill

Access Figma files via MCP (Model Context Protocol) or REST API.

## MCP CLI (Primary Method)

The `figma-mcp` CLI uses OAuth tokens stored by Claude Code to make authenticated MCP calls.

### Setup

OAuth is handled automatically when you run `/mcp` in Claude Code and connect to Figma. Tokens are stored in macOS keychain under "Claude Code-credentials".

### Usage

```bash
# List available MCP tools
~/.claude/skills/figma/scripts/figma-mcp list-tools

# Call any MCP tool
~/.claude/skills/figma/scripts/figma-mcp call <tool_name> '{"arg": "value"}'

# Debug: check token
~/.claude/skills/figma/scripts/figma-mcp token
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `generate_diagram` | Create FigJam diagrams from mermaid syntax |
| `generate_figma_design` | Capture web pages into Figma |
| `get_design_context` | Get design info for a node |
| `get_screenshot` | Screenshot a Figma node |
| `get_metadata` | Get node/page metadata |
| `whoami` | Get authenticated user info |

## Capture Web Pages to Figma

The MCP can capture HTML pages and convert them to editable Figma designs.

### Workflow

1. **Create HTML page** with the capture script:
```html
<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>
```

2. **Serve locally** (file:// URLs don't work):
```bash
cd /path/to/html && uv run python -m http.server 8765
```

3. **Get capture ID**:
```bash
~/.claude/skills/figma/scripts/figma-mcp call generate_figma_design \
  '{"outputMode": "newFile", "planKey": "team::TEAM_ID", "fileName": "My Design"}'
```

4. **Open page with capture params**:
```bash
open "http://localhost:8765/page.html#figmacapture=CAPTURE_ID&figmaendpoint=https%3A%2F%2Fmcp.figma.com%2Fmcp%2Fcapture%2FCAPTURE_ID%2Fsubmit&figmadelay=1000"
```

5. **Poll for completion**:
```bash
~/.claude/skills/figma/scripts/figma-mcp call generate_figma_design '{"captureId": "CAPTURE_ID"}'
```

6. **Claim the file** - opens in Figma with editable layers

### Known Issues

- **FigJam diagrams (generate_diagram) are BROKEN** - creates empty files despite returning success. Known Figma bug as of Feb 2026.
- Drafts can't be shared with email invites - must move to team project first, or use "Anyone with link" sharing.

## Sharing Figma Files (CRITICAL)

**WARNING: Just copying the URL does NOT make it viewable.** You MUST change sharing settings first.

### Free Tier Sharing Steps

1. Click **Share** button (top right)
2. Click on **"Only those invited"** row (under "Who has access")
3. Opens "Share settings" panel
4. Click dropdown → select **"Anyone"**
5. Under "What can they do" select **View** or **Edit**
6. Click **Save**
7. NOW copy the link - it will work for others

### Common Mistake

Just copying `https://www.figma.com/design/FILE_ID/...` without changing settings = link won't work for others. The default is "Only those invited" which blocks everyone.

### Alternative: Email Invite

To invite specific people (requires moving out of Drafts):
1. Share → Move file → Select team project → Move
2. Then you can add emails and click Invite

## REST API (Alternative)

For direct API access without MCP.

### Authentication

PAT stored in `~/.claude/secrets.env` as `FIGMA_PAT`.

```bash
source ~/.claude/secrets.env
curl -H "X-Figma-Token: $FIGMA_PAT" "https://api.figma.com/v1/files/FILE_ID"
```

### Getting File IDs

From URL: `https://www.figma.com/design/FILE_ID/File-Name`

### API Endpoints

```bash
# Get file metadata
curl -H "X-Figma-Token: $FIGMA_PAT" "https://api.figma.com/v1/files/$FILE_ID"

# Get specific node
curl -H "X-Figma-Token: $FIGMA_PAT" "https://api.figma.com/v1/files/$FILE_ID/nodes?ids=NODE_ID"

# Export images
curl -H "X-Figma-Token: $FIGMA_PAT" "https://api.figma.com/v1/images/$FILE_ID?ids=NODE_ID&format=png&scale=2"
```

## Chrome Automation for Figma

For UI automation (sharing, clicking buttons):

```bash
# Find Figma tabs
~/.claude/skills/chrome-control/scripts/chrome tabs | grep -i figma

# Click Share button via JS
~/.claude/skills/chrome-control/scripts/chrome js TAB_ID "
const shareBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Share');
shareBtn?.click();
"

# Type in input fields
~/.claude/skills/chrome-control/scripts/chrome js TAB_ID "
const input = document.querySelector('input[type=\"text\"]');
input.focus();
input.value = 'email@example.com';
input.dispatchEvent(new Event('input', {bubbles: true}));
"
```

**Note:** Figma uses React - must use `dispatchEvent` for input changes to trigger form validation.

## Token Locations

- **OAuth tokens**: macOS keychain → "Claude Code-credentials" → `mcpOAuth.figma*`
- **PAT**: `~/.claude/secrets.env` as `FIGMA_PAT`

OAuth expires ~30 days, PAT expires 90 days max.

## Known Files

| File | ID | Description |
|------|-----|-------------|
| Dashboard Design Test | YBa11Wdnf4J1ZHqfLqt7kO | Test dashboard captured from HTML |
| Astro App File | iHUDBKtiDYin9cMhrL9vt2 | Stargazer app wireframes |
