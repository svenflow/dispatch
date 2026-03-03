---
layout: default
title: Configuration
nav_order: 7
---

# Configuration
{: .no_toc }

All configuration options for Dispatch.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Config File

Configuration lives in `config.local.yaml` (gitignored). Copy from the template:

```bash
cp config.example.yaml config.local.yaml
```

## Required Settings

### Owner

```yaml
owner:
  name: "John Smith"
  phone: "+16175551234"
  email: "john@example.com"
```

### Assistant

```yaml
assistant:
  name: "Sven"
  email: "assistant@example.com"
  phone: "+19495551234"  # For Signal account
```

## Optional Settings

### Partner

```yaml
partner:
  name: "Jane Smith"
```

Used for the partner tier's warm tone personalization.

### Signal

```yaml
signal:
  account: "+19495551234"
```

The phone number registered with signal-cli.

### Smart Home

```yaml
hue:
  bridges:
    home:
      ip: "10.10.10.10"
    office:
      ip: "10.10.10.11"

lutron:
  bridge_ip: "10.10.10.12"
```

### Chrome Profiles

```yaml
chrome:
  profiles:
    0:
      name: "assistant"
      email: "assistant@example.com"
    1:
      name: "owner"
      email: "john@example.com"
```

Profile 0 is the assistant's Chrome profile. Profile 1+ are others.

### Podcast

```yaml
podcast:
  bucket: "my-podcast-bucket"
  title: "My Audio Articles"
  email: "john@example.com"
```

For the podcast skill's GCS hosting.

## Full Example

```yaml
# config.local.yaml

owner:
  name: "John Smith"
  phone: "+16175551234"
  email: "john@example.com"

partner:
  name: "Jane Smith"

assistant:
  name: "Sven"
  email: "assistant@example.com"
  phone: "+19495551234"

signal:
  account: "+19495551234"

hue:
  bridges:
    home:
      ip: "10.10.10.10"

lutron:
  bridge_ip: "10.10.10.12"

chrome:
  profiles:
    0:
      name: "sven"
      email: "assistant@example.com"
    1:
      name: "owner"
      email: "john@example.com"
```

## Accessing Config Values

Use the `identity` CLI:

```bash
~/dispatch/bin/identity owner.name      # → John Smith
~/dispatch/bin/identity owner.phone     # → +16175551234
~/dispatch/bin/identity hue.bridges.home.ip  # → 10.10.10.10
```

In skills and templates, use the `!`identity`` dynamic prompt:

```markdown
**!`identity owner.name`** is the owner.
```

This gets replaced at runtime with the actual value.

## Environment Variables

Override settings via environment:

| Variable | Description |
|----------|-------------|
| `DISPATCH_CONFIG` | Path to config file |
| `DISPATCH_LOG_LEVEL` | Log level (DEBUG, INFO, etc.) |
| `ANTHROPIC_API_KEY` | Claude API key |
