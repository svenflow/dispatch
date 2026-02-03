"""Config loader. Loads config.local.yaml, provides get()/require()."""

import yaml
from pathlib import Path
from typing import Any

ASSISTANT_DIR = Path(__file__).parent.parent
LOCAL_CONFIG_FILE = ASSISTANT_DIR / "config.local.yaml"

_config: dict = {}
_loaded = False


def load() -> dict:
    """Load config.local.yaml. Safe to call multiple times (cached)."""
    global _config, _loaded
    if _loaded:
        return _config

    if not LOCAL_CONFIG_FILE.exists():
        raise FileNotFoundError(
            f"Required config file not found: {LOCAL_CONFIG_FILE}\n"
            f"Copy config.example.yaml to config.local.yaml and fill in your values."
        )

    with open(LOCAL_CONFIG_FILE) as f:
        _config = yaml.safe_load(f) or {}

    _loaded = True
    return _config


def get(dotpath: str, default: Any = None) -> Any:
    """Get a config value by dot-separated path. e.g. get('signal.account')"""
    load()
    keys = dotpath.split(".")
    node = _config
    for key in keys:
        if isinstance(node, dict) and key in node:
            node = node[key]
        else:
            return default
    return node


def require(dotpath: str) -> Any:
    """Get a config value or raise if missing/falsy (None, '', 0, False)."""
    value = get(dotpath)
    if not value:
        raise ValueError(
            f"Required config '{dotpath}' is missing or falsy (got {value!r}). "
            f"Check config.local.yaml."
        )
    return value


def reload() -> dict:
    """Force reload from disk (useful for tests)."""
    global _loaded
    _loaded = False
    return load()
