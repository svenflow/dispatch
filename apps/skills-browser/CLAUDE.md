# Skills Browser

A GUI and CLI tool for browsing and rendering Claude skills.

## GUI

Launch the graphical skills browser:

```bash
cd ~/code/skills-browser
uv run python app.py

# Or via CLI
uv run python cli.py gui
```

## CLI Commands

```bash
cd ~/code/skills-browser

# List all skills
uv run python cli.py list

# Render a skill as PNG
uv run python cli.py render <skill-name>
uv run python cli.py render contacts -o /tmp/contacts.png
```

## SMS Integration

When a user asks to see a skill via SMS (e.g., "show me the contacts skill" or "what can you do with hue?"):

1. Render the skill as an image:
   ```bash
   cd ~/code/skills-browser && uv run python cli.py render <skill-name> -o /tmp/<skill>-skill.png
   ```

2. Send the image via iMessage:
   ```bash
   ~/code/sms-cli/send-sms "+phone" --image /tmp/<skill>-skill.png
   ```

This provides a nicely formatted visual representation of the skill documentation.

## Dependencies

- `pywebview` - Native window with webview for GUI
- `markdown` - Markdown to HTML conversion
- `html2image` - Headless Chrome for PNG rendering
