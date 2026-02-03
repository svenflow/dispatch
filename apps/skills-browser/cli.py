#!/usr/bin/env python3
"""CLI for rendering skills as PNG images."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import markdown
from html2image import Html2Image

SKILLS_DIR = Path.home() / ".claude" / "skills"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 30px 40px;
            width: 800px;
        }
        h1 { color: #fff; margin-bottom: 20px; font-size: 28px; }
        h2 { color: #ddd; margin: 25px 0 15px; border-bottom: 1px solid #444; padding-bottom: 8px; }
        h3 { color: #ccc; margin: 20px 0 10px; }
        p { line-height: 1.6; margin: 10px 0; }
        code {
            background: #2d2d2d;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'SF Mono', Menlo, monospace;
            font-size: 13px;
        }
        pre {
            background: #2d2d2d;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 15px 0;
        }
        pre code {
            background: none;
            padding: 0;
        }
        ul, ol {
            margin: 10px 0 10px 25px;
        }
        li {
            line-height: 1.8;
        }
        a {
            color: #4fc1ff;
        }
        table {
            border-collapse: collapse;
            margin: 15px 0;
        }
        th, td {
            border: 1px solid #444;
            padding: 8px 12px;
            text-align: left;
        }
        th {
            background: #2d2d2d;
        }
        hr {
            border: none;
            border-top: 1px solid #444;
            margin: 20px 0;
        }
        .frontmatter {
            background: #2a4a3a;
            border: 1px solid #3a6a4a;
            border-radius: 8px;
            padding: 15px 20px;
            margin-bottom: 25px;
        }
        .frontmatter-field {
            margin: 8px 0;
        }
        .frontmatter-key {
            color: #9cdcfe;
            font-weight: 500;
        }
        .frontmatter-value {
            color: #ce9178;
        }
    </style>
</head>
<body>
CONTENT_PLACEHOLDER
</body>
</html>
"""


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from content."""
    if not content.startswith('---'):
        return {}, content

    parts = content.split('---', 2)
    if len(parts) < 3:
        return {}, content

    frontmatter = {}
    for line in parts[1].strip().split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            frontmatter[key.strip()] = value.strip()

    return frontmatter, parts[2]


def frontmatter_to_html(fm: dict) -> str:
    """Convert frontmatter dict to styled HTML."""
    if not fm:
        return ""

    fields = []
    for key, value in fm.items():
        fields.append(
            f'<div class="frontmatter-field">'
            f'<span class="frontmatter-key">{key}:</span> '
            f'<span class="frontmatter-value">{value}</span>'
            f'</div>'
        )

    return f'<div class="frontmatter">{"".join(fields)}</div>'


def render_skill(skill_name: str, output_path: str | None = None) -> str:
    """Render a skill as a PNG image. Returns the output path."""
    skill_file = SKILLS_DIR / skill_name / "SKILL.md"
    
    if not skill_file.exists():
        raise FileNotFoundError(f"Skill not found: {skill_name}")
    
    content = skill_file.read_text()
    frontmatter, body = parse_frontmatter(content)
    
    md = markdown.Markdown(extensions=['fenced_code', 'tables', 'toc'])
    fm_html = frontmatter_to_html(frontmatter)
    body_html = md.convert(body)
    
    full_html = HTML_TEMPLATE.replace("CONTENT_PLACEHOLDER", fm_html + body_html)
    
    # Determine output path
    if output_path is None:
        output_path = f"/tmp/{skill_name}-skill.png"
    
    output_dir = str(Path(output_path).parent)
    output_file = Path(output_path).name
    
    # Render to PNG
    hti = Html2Image(output_path=output_dir, size=(800, 1200))
    hti.screenshot(html_str=full_html, save_as=output_file)
    
    return output_path


def list_skills() -> list[str]:
    """List all available skills."""
    if not SKILLS_DIR.exists():
        return []
    
    skills = []
    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if skill_dir.is_dir() and (skill_dir / "SKILL.md").exists():
            skills.append(skill_dir.name)
    return skills


def main():
    parser = argparse.ArgumentParser(
        prog="skills-browser",
        description="Browse and render Claude skills"
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # gui - launch GUI
    subparsers.add_parser("gui", help="Launch the Skills Browser GUI")
    
    # list - list all skills
    subparsers.add_parser("list", help="List all available skills")
    
    # render - render skill as PNG
    render_parser = subparsers.add_parser("render", help="Render a skill as PNG")
    render_parser.add_argument("skill", help="Skill name to render")
    render_parser.add_argument("-o", "--output", help="Output path (default: /tmp/<skill>-skill.png)")
    
    args = parser.parse_args()
    
    if args.command == "gui" or args.command is None:
        # Launch GUI
        from app import main as gui_main
        gui_main()
    
    elif args.command == "list":
        skills = list_skills()
        if skills:
            print("Available skills:")
            for skill in skills:
                print(f"  {skill}")
        else:
            print("No skills found")
    
    elif args.command == "render":
        try:
            output = render_skill(args.skill, args.output)
            print(f"Rendered: {output}")
        except FileNotFoundError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
