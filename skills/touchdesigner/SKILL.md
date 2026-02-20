---
name: touchdesigner
description: Control TouchDesigner from the command line. Create nodes, set parameters, wire connections, render videos. Trigger words - touchdesigner, td, visual programming, generative art, render.
---

# TouchDesigner CLI

Control TouchDesigner programmatically via the WebServer DAT API.

## Prerequisites

1. TouchDesigner installed with the MCP WebServer component
2. WebServer running on port 9981 (default)

### Setup TouchDesigner

1. Download `mcp_webserver_base.tox` from the touchdesigner-mcp releases
2. Place it at `~/Documents/touchdesigner-mcp-td/` with the `modules/` folder
3. Open the tox file with TouchDesigner
4. The WebServer will start automatically on port 9981

## Configuration

Create `~/.config/td/config.toml`:

```toml
[server]
host = "localhost"
port = 9981
timeout = 30.0

[render]
default_fps = 30
default_duration = 5.0
output_dir = "/tmp"
```

## CLI Usage

```bash
# Add to PATH
export PATH="$PATH:~/.claude/skills/touchdesigner/scripts"

# Or use full path
~/.claude/skills/touchdesigner/scripts/td <command>

# Enable verbose/debug mode
td -v <command>
```

## Commands

### Core Commands

```bash
# Check if TD is running
td ping

# Get server info
td info
td info --json

# Execute Python in TD
td exec "1 + 1"
td exec "op('/project1').create('noiseTOP', 'my_noise')"
td exec -f script.py
td exec "code" --dry-run  # show what would run

# Variable substitution in scripts
td exec -f template.py -V seed=42 -V name=demo
# In template.py: uses ${seed} and $(name) placeholders
```

### Node Management

```bash
# List nodes
td node ls /                    # root level
td node ls /project1            # specific path
td node ls / --json             # JSON output
td node ls / -r                 # recursive

# Create nodes
td node create / noiseTOP my_noise
td node create /project1 levelTOP
td node create / moviefileoutTOP render_out

# Get node details
td node get /my_noise
td node get /my_noise --json

# Set parameters
td node set /my_noise seed=42 period=2.0
td node set /my_level contrast=1.5 brightness1=0.5

# List all parameters with current values
td node params /my_noise
td node params /my_noise --filter seed
td node params /my_noise --json

# Call a method on a node
td node call /my_noise cook
td node call /my_noise destroy

# Delete nodes
td node rm /my_noise
td node rm /my_noise --dry-run

# Check for errors
td node errors /project1
```

### Wiring Connections

```bash
# Connect nodes
td wire connect /noise1 /level1

# Disconnect nodes
td wire disconnect /noise1 /level1

# Show connections for a node
td wire ls /my_node
```

### Rendering

```bash
# Start recording (MovieFileOut TOP)
td render start /render_out

# Stop recording
td render stop /render_out

# Check recording status
td render status /render_out

# Record for specific duration with progress bar
td render wait /render_out --duration 5
td render wait /render_out -d 10 --no-progress

# Full workflow:
td node create / moviefileoutTOP render_out
td node set /render_out file=/tmp/output.mov
td wire connect /my_visual /render_out
td render wait /render_out --duration 10
```

### Performance Monitoring

```bash
# Show FPS, realtime status, memory usage
td perf

# Show cook time for specific node
td perf /my_noise

# JSON output for scripting
td perf --json
```

### Snapshots (Save/Restore State)

```bash
# Save current parameters to a snapshot
td snapshot save my_preset
td snapshot save colorful --path /noise_visual

# Restore parameters from snapshot
td snapshot restore my_preset

# List all saved snapshots
td snapshot ls
```

Snapshots are saved to `~/.config/td/snapshots/`.

### Presets (Reusable Parameter Sets)

```bash
# Save node parameters as a reusable preset
td preset save my_noise_look /my_noise --desc "Colorful perlin noise"

# Apply preset to any node of same type
td preset apply my_noise_look /other_noise

# List all presets
td preset ls
```

Presets are saved to `~/.config/td/presets/`.

### Live Coding (Watch Mode)

```bash
# Watch a Python script and re-execute on changes
td watch ~/scripts/my_effect.py

# Custom check interval
td watch ~/scripts/my_effect.py --interval 0.5
```

### Discovery

```bash
# List available TD classes
td classes
td classes --filter noise

# Get help for a class
td help noiseTOP
td help levelTOP
```

## Output Formats

All commands support `--json` for scripting:

```bash
td node ls / --json | jq '.data.nodes[].name'
td info --json | jq '.data.version'
```

## Examples

### Create a Simple Visual Chain

```bash
# Create nodes
td node create / noiseTOP noise1
td node create / levelTOP level1
td node create / nullTOP out1

# Wire them
td wire connect /noise1 /level1
td wire connect /level1 /out1

# Check wiring
td wire ls /level1

# Adjust parameters
td node set /noise1 seed=42 period=2.0
td node set /level1 contrast=1.5 brightness1=0.3
```

### Animated Render

```bash
# Create animated noise (expression-driven)
td exec "
noise = op('/noise1')
noise.par.seed.expr = 'int(absTime.seconds * 3)'  # Animate seed
noise.par.period = 0.5
"

# Render with progress bar
td render wait /render --duration 10

# Convert to h265 for iMessage
ffmpeg -i /tmp/output.mov -c:v hevc_videotoolbox -tag:v hvc1 -b:v 20M /tmp/final.mov
```

### Scripting with Variables

```bash
# Create a template script (template.py):
# noise = op('/').create('noiseTOP', '${name}')
# noise.par.seed = ${seed}

# Run with variables
td exec -f template.py -V name=my_noise -V seed=42
```

### Live Coding Workflow

```bash
# Create a script file
cat > ~/td_live.py << 'EOF'
noise = op('/noise1')
if noise:
    noise.par.seed = absTime.frame % 100
    noise.par.period = 1.0 + 0.5 * me.time.seconds % 2
EOF

# Watch and iterate
td watch ~/td_live.py
```

## Video Encoding for iMessage

TouchDesigner outputs MJPEG by default. For iMessage compatibility, convert to h265:

```bash
# High quality for iMessage
ffmpeg -i /tmp/td_output.mov \
  -c:v hevc_videotoolbox \
  -tag:v hvc1 \
  -b:v 20M -maxrate 25M -bufsize 40M \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -brand qt \
  /tmp/td_final.mov
```

## Troubleshooting

### TD not responding
1. Make sure TouchDesigner is running
2. Check that the MCP WebServer component is loaded
3. Verify port 9981 is open: `lsof -i :9981`

### Permission errors
The WebServer DAT may prompt for permissions on first use.

### Node type not found
Use `td classes --filter <type>` to find the correct class name. Types are case-sensitive (e.g., `noiseTOP` not `noisetop`).

### Static/empty video
Make sure your visual chain is properly wired to the MovieFileOut TOP. Use `td wire ls /node` to verify connections.

### Verbose mode
Use `-v` flag for debug output: `td -v node ls /`
