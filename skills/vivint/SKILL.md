---
name: vivint
description: Control Vivint smart home system - cameras, RTSP streams, panel credentials. Trigger words - vivint, security camera, rtsp, camera stream.
allowed_tiers:
  - admin
  - wife
---

# Vivint Smart Home Skill

**Access restricted to admin and wife tiers only.**

Access Vivint security cameras via local RTSP streams.

## Prerequisites

1. **Vivint account password in keychain**:
   ```bash
   security add-generic-password -a "YOUR_EMAIL" -s "vivint" -w "YOUR_PASSWORD"
   ```

2. **MFA setup**: Account must have TOTP authenticator app configured (e.g., Google Authenticator)

3. **OpenCV for snapshots**:
   ```bash
   /usr/bin/pip3 install --user opencv-python-headless
   ```

## Quick Start

```bash
# Get panel credentials and camera list (uses cached tokens)
~/.claude/skills/vivint/scripts/vivint-auth --cameras

# Capture a camera snapshot
~/.claude/skills/vivint/scripts/vivint-snapshot "Front Door"
~/.claude/skills/vivint/scripts/vivint-snapshot "driveway" --panel "nikhil"
~/.claude/skills/vivint/scripts/vivint-snapshot "Front Door"        # HD quality (default)
~/.claude/skills/vivint/scripts/vivint-snapshot "Front Door" --sd   # SD quality (512x512)
~/.claude/skills/vivint/scripts/vivint-snapshot --list  # List all cameras

# JSON output for programmatic use
~/.claude/skills/vivint/scripts/vivint-auth --cameras --json

# Filter to specific panel
~/.claude/skills/vivint/scripts/vivint-auth --cameras --panel "house"

# Force token refresh
~/.claude/skills/vivint/scripts/vivint-auth --refresh --cameras
```

## Capturing Snapshots

The `vivint-snapshot` script uses OpenCV to capture frames from RTSP streams. It automatically:
- Uses the local IP from the `cia` field (not the VPN IP in `cous`)
- Handles Digest authentication required by LIVE555 server
- Outputs to `/tmp/<camera_name>_snapshot.jpg` by default

**CRITICAL:** Must use system Python (`/usr/bin/python3`), not uv. The uv sandbox blocks TCP connections to local network IPs, causing "No route to host" errors.

## Initial Authentication Flow

First run requires MFA:

```bash
# Step 1: Try to authenticate (will prompt for MFA)
~/.claude/skills/vivint/scripts/vivint-auth --email user@example.com
# Output: "MFA required (type: mfa). Run again with --mfa CODE"

# Step 2: Get TOTP code from authenticator app, then:
~/.claude/skills/vivint/scripts/vivint-auth --email user@example.com --mfa 123456
# Success! Tokens saved.
```

After initial auth, tokens auto-refresh for 7+ days without MFA.

## State Files

| File | Contents |
|------|----------|
| `~/.claude/skills/vivint/state/tokens.json` | OAuth tokens (7-day access, has refresh_token) |
| `~/.claude/skills/vivint/state/panels.json` | Cached panel and camera data |
| `~/.claude/skills/vivint/state/config.json` | Account email for authentication |

## RTSP Stream Details

### URL Format
```
rtsp://USER:PASS@LOCAL_IP:8554/Video-XX_SD   # Standard definition (512x512)
rtsp://USER:PASS@LOCAL_IP:8554/Video-XX      # Higher resolution (960x960) - use for HD
```
Note: The `_HD` suffix does NOT exist. For higher resolution, omit the suffix entirely.

### Critical: IP Address Selection

The Vivint API returns **two different IPs** for cameras:

| Field | Example | Use |
|-------|---------|-----|
| `cous` (local_stream) | `rtsp://10.231.48.160:8554/Video-29_SD` | **VPN/internal IP - DOES NOT WORK from LAN** |
| `cia` (local_ip) | `https://10.10.10.33:8557/Audio-29` | **Actual LAN IP - USE THIS** |

**Always extract the IP from `cia` field, not `cous`!** The 10.231.x.x and 10.225.x.x IPs are Vivint's internal VPN addresses and are unreachable from your local network.

### Authentication

The RTSP server uses **Digest authentication** (not Basic). Tools that handle this properly:
- ✅ OpenCV (`cv2.VideoCapture`) - works
- ✅ curl with `-v` flag - works for probing
- ✅ System Python sockets - work
- ❌ ffmpeg from uv/homebrew - blocked by sandbox
- ❌ uv Python - blocked by sandbox

### RTSP Server Info
- Server: LIVE555 Streaming Media v2022.12.01
- Codecs: H264 video, Opus audio
- Port: 8554 (RTSP), 8557 (HTTPS audio)

## API Details

### Authentication (PKCE OAuth)
- **Auth endpoint**: `https://id.vivint.com/oauth2/auth`
- **Token endpoint**: `https://id.vivint.com/oauth2/token`
- **Credential submit**: `https://id.vivint.com/idp/api/submit`
- **MFA validate**: `https://id.vivint.com/idp/api/submit` (TOTP) or `/validate` (SMS)
- **Client ID**: `ios`
- **Redirect URI**: `vivint://app/oauth_redirect`

### Data API
- **Base**: `https://www.vivintsky.com/api`
- **Get panels**: `GET /authuser` → `.u.system[]`
- **Get RTSP creds**: `GET /panel-login/{panelId}` → `{n: username, pswd: password}`
- **Get cameras**: `GET /systems/{panelId}` → `.system.par[].d[]` (filter for cous/ceu fields)

### Token Refresh with curl
```bash
REFRESH_TOKEN=$(cat ~/.claude/skills/vivint/state/tokens.json | jq -r .refresh_token)
curl -s -X POST "https://id.vivint.com/oauth2/token?client_id=ios" \
  -d "grant_type=refresh_token&refresh_token=$REFRESH_TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" > ~/.claude/skills/vivint/state/tokens.json
```

## Token Lifecycle

1. **Access token**: 7 days (604800 seconds)
2. **Refresh token**: Long-lived, allows renewal without MFA
3. **RTSP credentials**: "Very infrequently" rotated (weeks to months)

## Troubleshooting

**Enable debug mode for verbose output:**
```bash
~/.claude/skills/vivint/scripts/vivint-auth --debug --cameras
```

**"MFA required" on every run?**
- Tokens may have expired. Use `--refresh` to force re-auth with MFA code.

**401 on panel-login?**
- Tokens valid but MFA session incomplete. Re-run full auth flow.

**Corrupted state files?**
```bash
# Reset all state and tokens (will require re-auth with MFA)
~/.claude/skills/vivint/scripts/vivint-auth --reset
```

**"No route to host" errors?**
- You're probably using the wrong IP. Use IP from `cia` field, not `cous`.
- Or you're using uv/ffmpeg which are sandboxed. Use system Python.

**ffmpeg/uv can't connect but curl can?**
- This is a sandbox issue. System binaries (nc, curl, /usr/bin/python3) work fine.
- Homebrew/uv binaries are sandboxed and can't reach local network IPs.
- Solution: Use `vivint-snapshot` which uses system Python.

**RTSP stream not connecting?**
- Verify you're on the same LAN as the panel
- Check that port 8554 is open: `nc -z IP 8554`
- Test with curl: `curl -v rtsp://IP:8554/`

## Security Notes

- Vivint password stored in macOS Keychain (service: `vivint`)
- OAuth tokens stored in macOS Keychain (service: `vivint-tokens`, account: `oauth`)
  - Backup also written to state file with 0600 permissions
  - Tokens auto-migrate from file to keychain on first use
- State files have restrictive permissions (0700 for dir, 0600 for files)
- RTSP credentials are per-panel, not per-camera
- All API calls use HTTPS
- Use `--hide-credentials` to suppress RTSP passwords in output
