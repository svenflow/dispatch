---
name: cad
description: Generate 3D CAD models programmatically using CadQuery. Create parametric parts, export STL/STEP, render previews. Trigger words - cad, 3d model, parametric, stl, step, bracket, enclosure, part.
---

# CAD Skill

Generate 3D CAD models programmatically using CadQuery (Python) with Blender rendering.

## Quick Start

```bash
# Generate a model from description
~/.claude/skills/cad/scripts/cad-generate "box with 4 mounting holes"

# Render an existing STL
~/.claude/skills/cad/scripts/cad-render /path/to/model.stl

# List example templates
~/.claude/skills/cad/scripts/cad-generate --list-templates
```

## Capabilities

- **Parametric modeling**: Dimensions, hole patterns, arrays all adjustable
- **Export formats**: STL (3D printing), STEP (CAD interchange)
- **Rendering**: Blender Cycles GPU rendering for previews
- **Common parts**: Brackets, enclosures, mounts, spacers, adapters

## Architecture

```
User prompt → Claude generates CadQuery Python → Execute → STL/STEP
                                                    ↓
                                              Blender render → PNG
```

## Python Environment

Uses dedicated venv at `~/.venvs/cad` with Python 3.12:
- cadquery (parametric CAD)
- cadquery-ocp (OpenCASCADE kernel)

## Example Code

```python
import cadquery as cq

# L-bracket with mounting holes
result = (
    cq.Workplane("XY")
    .box(50, 30, 5)                    # Base plate
    .faces(">Z").workplane()
    .move(0, 12.5)
    .box(50, 5, 40, centered=(True, True, False))  # Vertical
    .faces("<Z").workplane()
    .pushPoints([(-15, 0), (15, 0)])
    .hole(5)                           # Mounting holes
)

cq.exporters.export(result, "bracket.stl")
cq.exporters.export(result, "bracket.step")
```

## Common Patterns

### Hole Arrays
```python
.pushPoints([(x, y) for x in [-20, 0, 20] for y in [-10, 10]])
.hole(diameter)
```

### Fillets (rounded edges)
```python
.edges("|Z").fillet(radius)  # Vertical edges
.edges(">Z").fillet(radius)  # Top edges
```

### Shell (hollow out)
```python
.shell(-wall_thickness)  # Negative = outward, positive = inward
```

### Extrude with taper
```python
.extrude(height, taper=5)  # 5 degree draft angle
```

## Rendering

Uses Blender Cycles with:
- GPU acceleration (Metal on macOS)
- 64 samples for quick preview
- Blue metallic material
- Dark background

## Limitations

- No GUI preview (headless only)
- Fillets can fail on complex geometry (use simpler shapes)
- Large models may take longer to render

## Output Locations

- STL/STEP: `/tmp/cad_output/` (timestamped)
- Renders: `/tmp/cad_output/` (PNG)
