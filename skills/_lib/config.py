"""Shared config helper for standalone skill scripts.

Usage from any skill script:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path.home() / "dispatch/skills/_lib"))
    from config import cfg

    BRIDGE_IP = cfg("lutron.bridge_ip")
"""

import yaml
from pathlib import Path
from typing import Any

_CONFIG_FILE = Path.home() / "dispatch/config.local.yaml"
_config: dict | None = None


def cfg(dotpath: str, default: Any = None) -> Any:
    """Get a config value by dot-separated path from config.local.yaml."""
    global _config
    if _config is None:
        if not _CONFIG_FILE.exists():
            return default
        with open(_CONFIG_FILE) as f:
            _config = yaml.safe_load(f) or {}

    node = _config
    for key in dotpath.split("."):
        if isinstance(node, dict) and key in node:
            node = node[key]
        else:
            return default
    return node
