---
name: figma
description: Access Figma designs via MCP or Chrome. Use when asked about Figma files, design mockups, wireframes, or UI designs.
---

# Figma Skill

Access Figma files and designs via the REST API.

## Authentication

PAT stored in `~/.claude/secrets.env` as `FIGMA_PAT`.

```bash
source ~/.claude/secrets.env
curl -H "X-Figma-Token: $FIGMA_PAT" "https://api.figma.com/v1/files/FILE_ID"
```

## Getting File IDs

From Figma URL: `https://www.figma.com/design/FILE_ID/File-Name`
Example: `https://www.figma.com/design/iHUDBKtiDYin9cMhrL9vt2/Astro-App-File` → FILE_ID = `iHUDBKtiDYin9cMhrL9vt2`

## API Endpoints

### Get File Metadata
```bash
curl -H "X-Figma-Token: $FIGMA_PAT" "https://api.figma.com/v1/files/$FILE_ID"
```

### Get Specific Node
```bash
curl -H "X-Figma-Token: $FIGMA_PAT" "https://api.figma.com/v1/files/$FILE_ID/nodes?ids=NODE_ID"
```

### Export Images
```bash
curl -H "X-Figma-Token: $FIGMA_PAT" "https://api.figma.com/v1/images/$FILE_ID?ids=NODE_ID&format=png&scale=2"
```

## Common Tasks

### Extract Text Content from Figma File

```python
import json
import os
import subprocess

def get_figma_file(file_id):
    token = os.environ.get('FIGMA_PAT')
    result = subprocess.run([
        'curl', '-s', '-H', f'X-Figma-Token: {token}',
        f'https://api.figma.com/v1/files/{file_id}'
    ], capture_output=True, text=True)
    return json.loads(result.stdout)

def extract_text(node, texts=None):
    if texts is None:
        texts = []
    if node.get('type') == 'TEXT' and 'characters' in node:
        texts.append(node['characters'].strip())
    for child in node.get('children', []):
        extract_text(child, texts)
    return texts
```

## Token Generation (if needed)

To generate a new PAT via Chrome automation:

1. Navigate to Figma and open account dropdown
2. Go to Settings → Security → Generate new token
3. Fill token name with React-compatible setter:
   ```javascript
   const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
   const tokenInput = Array.from(document.querySelectorAll('input[type="text"]')).find(i => !i.placeholder);
   nativeInputValueSetter.call(tokenInput, 'token-name');
   tokenInput.dispatchEvent(new Event('input', {bubbles: true}));
   ```
4. Click scope checkboxes
5. Click Generate token button (only enabled when form is valid)
6. Save token to `~/.claude/secrets.env`

**Key insight:** Figma uses React - must use nativeInputValueSetter for text inputs or form validation fails.

## Known Files

| File | ID | Description |
|------|-----|-------------|
| Astro App File | iHUDBKtiDYin9cMhrL9vt2 | Caroline's Stargazer app research/wireframes |
