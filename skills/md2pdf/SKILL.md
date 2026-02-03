---
name: md2pdf
description: Convert markdown files to beautifully styled PDFs. Use when converting markdown to pdf, generating PDF documents from markdown, or creating printable documents.
---

# Markdown to PDF Converter

Convert markdown files to beautifully styled PDFs using Chrome headless rendering.

## Usage

```bash
# Basic conversion (outputs to same directory as input)
uv run ~/.claude/skills/md2pdf/scripts/convert.py input.md

# Specify output path
uv run ~/.claude/skills/md2pdf/scripts/convert.py input.md -o output.pdf

# Use a different theme
uv run ~/.claude/skills/md2pdf/scripts/convert.py input.md --theme minimal

# List available themes
uv run ~/.claude/skills/md2pdf/scripts/convert.py --list-themes
```

## Available Themes

- **default** - Clean, professional look with GitHub-style code highlighting
- **minimal** - Ultra-clean with minimal styling
- **academic** - Serif fonts, suitable for academic papers

## Features

- Beautiful typography with system fonts
- GitHub-style syntax highlighting for code blocks
- Proper table styling with alternating row colors
- Blockquote styling with left border accent
- Print-optimized with page break controls
- Responsive margins for readability

## How It Works

1. Converts markdown to HTML using Python-Markdown with extensions
2. Applies CSS styling with syntax highlighting
3. Uses Chrome headless mode to render HTML to PDF

## Supported Markdown Features

- Headers (h1-h6)
- Code blocks with syntax highlighting (specify language)
- Inline code
- Tables
- Blockquotes
- Ordered and unordered lists
- Links and images
- Horizontal rules
- Task lists (checkboxes)

## Page Breaks

To force a page break in your markdown, add:

```markdown
<div class="page-break"></div>
```

## Requirements

- Google Chrome installed at `/Applications/Google Chrome.app/`
- Python packages: markdown, pygments (handled via uv inline deps)
