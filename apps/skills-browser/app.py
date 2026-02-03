#!/usr/bin/env python3
"""Skills Browser - View Claude skills with markdown preview."""
from __future__ import annotations

import json
from pathlib import Path

import markdown
import webview

SKILLS_DIR = Path.home() / ".claude" / "skills"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            height: 100vh;
            background: #1e1e1e;
            color: #d4d4d4;
        }
        #sidebar {
            width: 240px;
            background: #252526;
            border-right: 1px solid #3c3c3c;
            overflow-y: auto;
            flex-shrink: 0;
        }
        #sidebar h2 {
            padding: 15px;
            font-size: 14px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .skill-folder {
            user-select: none;
        }
        .skill-header {
            padding: 8px 15px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            border-left: 3px solid transparent;
            transition: all 0.15s;
        }
        .skill-header:hover {
            background: #2a2d2e;
        }
        .skill-header.active {
            background: #37373d;
            border-left-color: #007acc;
        }
        .skill-header .icon {
            font-size: 12px;
            width: 16px;
            color: #888;
            transition: transform 0.15s;
        }
        .skill-header.expanded .icon {
            transform: rotate(90deg);
        }
        .skill-name {
            font-weight: 500;
        }
        .skill-files {
            display: none;
            padding-left: 20px;
        }
        .skill-files.expanded {
            display: block;
        }
        .skill-file {
            padding: 6px 15px 6px 25px;
            cursor: pointer;
            font-size: 13px;
            color: #aaa;
            border-left: 3px solid transparent;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .skill-file:hover {
            background: #2a2d2e;
        }
        .skill-file.active {
            background: #37373d;
            border-left-color: #569cd6;
            color: #fff;
        }
        .skill-file .file-icon {
            font-size: 11px;
            color: #888;
        }
        .scripts-folder {
            padding: 6px 15px 6px 25px;
            font-size: 13px;
            color: #888;
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }
        .scripts-folder:hover {
            background: #2a2d2e;
        }
        .scripts-folder .folder-icon {
            font-size: 11px;
        }
        .script-files {
            display: none;
            padding-left: 15px;
        }
        .script-files.expanded {
            display: block;
        }
        .script-file {
            padding: 4px 15px 4px 35px;
            cursor: pointer;
            font-size: 12px;
            color: #999;
            border-left: 3px solid transparent;
        }
        .script-file:hover {
            background: #2a2d2e;
        }
        .script-file.active {
            background: #37373d;
            border-left-color: #dcdcaa;
            color: #dcdcaa;
        }
        #content {
            flex: 1;
            padding: 30px 40px;
            overflow-y: auto;
        }
        #content h1 { color: #fff; margin-bottom: 20px; }
        #content h2 { color: #ddd; margin: 25px 0 15px; border-bottom: 1px solid #444; padding-bottom: 8px; }
        #content h3 { color: #ccc; margin: 20px 0 10px; }
        #content p { line-height: 1.6; margin: 10px 0; }
        #content code {
            background: #2d2d2d;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'SF Mono', Menlo, monospace;
            font-size: 13px;
        }
        #content pre {
            background: #2d2d2d;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 15px 0;
        }
        #content pre code {
            background: none;
            padding: 0;
        }
        #content ul, #content ol {
            margin: 10px 0 10px 25px;
        }
        #content li {
            line-height: 1.8;
        }
        #content a {
            color: #4fc1ff;
        }
        #content table {
            border-collapse: collapse;
            margin: 15px 0;
        }
        #content th, #content td {
            border: 1px solid #444;
            padding: 8px 12px;
            text-align: left;
        }
        #content th {
            background: #2d2d2d;
        }
        #placeholder {
            color: #666;
            font-size: 18px;
            text-align: center;
            margin-top: 100px;
        }
        #content hr {
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
        .file-path {
            color: #666;
            font-size: 12px;
            margin-bottom: 15px;
            font-family: 'SF Mono', Menlo, monospace;
        }
    </style>
</head>
<body>
    <div id="sidebar">
        <h2>Skills</h2>
        <div id="skill-list"></div>
    </div>
    <div id="content">
        <div id="placeholder">Select a skill or file to view</div>
    </div>
    <script>
        const skillsData = SKILLS_DATA;
        const skillList = document.getElementById('skill-list');
        const content = document.getElementById('content');

        // Build sidebar with folder structure
        Object.keys(skillsData).sort().forEach(skillName => {
            const skill = skillsData[skillName];
            const folder = document.createElement('div');
            folder.className = 'skill-folder';

            // Skill header (folder name)
            const header = document.createElement('div');
            header.className = 'skill-header';
            header.innerHTML = `<span class="icon">▶</span><span class="skill-name">${skillName}</span>`;

            // Files container
            const filesContainer = document.createElement('div');
            filesContainer.className = 'skill-files';

            // Add files
            skill.files.forEach(file => {
                if (file.type === 'file') {
                    const fileEl = document.createElement('div');
                    fileEl.className = 'skill-file';
                    const icon = file.name.endsWith('.md') ? '📄' : '📜';
                    fileEl.innerHTML = `<span class="file-icon">${icon}</span>${file.name}`;
                    fileEl.onclick = (e) => {
                        e.stopPropagation();
                        selectFile(skillName, file.name, file.content, fileEl);
                    };
                    filesContainer.appendChild(fileEl);
                } else if (file.type === 'folder' && file.name === 'scripts') {
                    // Scripts folder
                    const scriptsFolder = document.createElement('div');
                    scriptsFolder.className = 'scripts-folder';
                    scriptsFolder.innerHTML = `<span class="folder-icon">📁</span>scripts/`;

                    const scriptFiles = document.createElement('div');
                    scriptFiles.className = 'script-files';

                    file.children.forEach(script => {
                        const scriptEl = document.createElement('div');
                        scriptEl.className = 'script-file';
                        scriptEl.textContent = script.name;
                        scriptEl.onclick = (e) => {
                            e.stopPropagation();
                            selectFile(skillName, `scripts/${script.name}`, script.content, scriptEl);
                        };
                        scriptFiles.appendChild(scriptEl);
                    });

                    scriptsFolder.onclick = (e) => {
                        e.stopPropagation();
                        scriptFiles.classList.toggle('expanded');
                    };

                    filesContainer.appendChild(scriptsFolder);
                    filesContainer.appendChild(scriptFiles);
                }
            });

            // Toggle expand/collapse
            header.onclick = () => {
                header.classList.toggle('expanded');
                filesContainer.classList.toggle('expanded');
            };

            folder.appendChild(header);
            folder.appendChild(filesContainer);
            skillList.appendChild(folder);
        });

        function selectFile(skillName, fileName, htmlContent, element) {
            // Clear all active states
            document.querySelectorAll('.skill-file, .script-file, .skill-header').forEach(el => {
                el.classList.remove('active');
            });
            element.classList.add('active');

            // Show content with path
            const pathHtml = `<div class="file-path">~/.claude/skills/${skillName}/${fileName}</div>`;
            content.innerHTML = pathHtml + htmlContent;
        }

        // Auto-expand and select first SKILL.md
        const firstFolder = skillList.querySelector('.skill-folder');
        if (firstFolder) {
            const header = firstFolder.querySelector('.skill-header');
            const files = firstFolder.querySelector('.skill-files');
            header.classList.add('expanded');
            files.classList.add('expanded');
            const firstFile = files.querySelector('.skill-file');
            if (firstFile) {
                firstFile.click();
            }
        }
    </script>
</body>
</html>
"""


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from content. Returns (frontmatter_dict, remaining_content)."""
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


def convert_to_html(content: str, is_markdown: bool = True) -> str:
    """Convert content to HTML."""
    md = markdown.Markdown(extensions=['fenced_code', 'tables', 'toc'])

    if is_markdown:
        frontmatter, body = parse_frontmatter(content)
        fm_html = frontmatter_to_html(frontmatter)
        body_html = md.convert(body)
        return fm_html + body_html
    else:
        # For non-markdown files, wrap in pre/code
        escaped = content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        return f'<pre><code>{escaped}</code></pre>'


def load_skills() -> dict[str, dict]:
    """Load all skills with their files."""
    skills = {}

    if not SKILLS_DIR.exists():
        return skills

    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue

        skill_data = {
            "name": skill_dir.name,
            "files": []
        }

        # Get all files in skill directory
        for item in sorted(skill_dir.iterdir()):
            if item.name.startswith('.'):
                continue

            if item.is_file():
                try:
                    content = item.read_text()
                    is_md = item.suffix == '.md'
                    html_content = convert_to_html(content, is_md)
                    skill_data["files"].append({
                        "type": "file",
                        "name": item.name,
                        "content": html_content
                    })
                except Exception as e:
                    skill_data["files"].append({
                        "type": "file",
                        "name": item.name,
                        "content": f"<p>Error loading: {e}</p>"
                    })

            elif item.is_dir() and item.name == 'scripts':
                # Handle scripts folder
                scripts = []
                for script in sorted(item.iterdir()):
                    if script.is_file() and not script.name.startswith('.'):
                        try:
                            content = script.read_text()
                            html_content = convert_to_html(content, False)
                            scripts.append({
                                "name": script.name,
                                "content": html_content
                            })
                        except Exception as e:
                            scripts.append({
                                "name": script.name,
                                "content": f"<p>Error loading: {e}</p>"
                            })

                if scripts:
                    skill_data["files"].append({
                        "type": "folder",
                        "name": "scripts",
                        "children": scripts
                    })

        if skill_data["files"]:
            skills[skill_dir.name] = skill_data

    return skills


def main():
    skills = load_skills()
    html = HTML_TEMPLATE.replace('SKILLS_DATA', json.dumps(skills))

    window = webview.create_window(
        'Skills Browser',
        html=html,
        width=1000,
        height=750,
        min_size=(700, 500)
    )
    webview.start()


if __name__ == "__main__":
    main()
