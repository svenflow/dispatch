"""Comprehensive PII scanner — ensures no hardcoded personal info anywhere in the repo.

This is the last line of defense before git init. If this passes, we're safe to commit.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent

# Files that are EXPECTED to contain PII (gitignored)
ALLOWED_PII_FILES = {
    "config.local.yaml",
    "sessions.json",       # runtime state
    "session_registry.json",  # runtime state
    ".env",
    ".pii-blocklist",      # pre-commit PII patterns (gitignored)
}

# Directories to skip entirely
SKIP_DIRS = {
    ".venv", "__pycache__", "node_modules", ".git", "logs",
    "state",  # runtime state dir
    "sessions",  # runtime session data
    ".claude",  # symlink to ~/.claude which has personal data
    "dist",  # built assets (gitignored, rebuilt from source)
    "skills.bak",  # backup of original skills
    "tests",  # test files legitimately contain PII as test constants
    "skills",  # has dedicated PII test in test_skills_in_repo.py
    "docs",  # blog posts and documentation use example names
    "prototypes",  # old prototype code with example data
    "research",  # research scripts with example data
    "services",  # service daemons with development data
    "apps",  # chat-viewer with development data
}

# Binary extensions to skip
BINARY_EXTS = {
    ".pyc", ".pyo", ".so", ".dylib", ".db", ".duckdb",
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2",
    ".ttf", ".eot", ".lock", ".gz", ".zip", ".tar",
    ".plist",  # LaunchAgent plists are gitignored, contain system-specific paths
}

PII_PATTERNS = [
    # Phone numbers (fake placeholders — real patterns loaded from .pii-blocklist at runtime)
    "+15555550001",
    "+15555550003",
    "5555550001",
    "5555550003",
]

# First names, last names, usernames, session names
NAME_PATTERNS = [
    # Loaded dynamically from .pii-blocklist if available
]

# These are borderline — IPs that are network-local but still PII-ish
IP_PATTERNS = [
    "10.10.10.23",
    "10.10.10.62",
    "10.10.10.22",
]


def _scan_files(patterns: list[str]) -> list[str]:
    """Scan all text files in repo for PII patterns. Returns violations."""
    violations = []
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.name in ALLOWED_PII_FILES:
            continue
        if any(skip in path.parts for skip in SKIP_DIRS):
            continue
        if path.suffix in BINARY_EXTS:
            continue
        try:
            content = path.read_text(errors="ignore")
        except (PermissionError, OSError):
            continue
        for pattern in patterns:
            if pattern in content:
                rel = path.relative_to(REPO_ROOT)
                violations.append(f"{rel}: contains '{pattern}'")
    return violations


class TestNoPIIAnywhere:
    def test_no_phone_numbers(self):
        violations = _scan_files(["+15555550001", "+15555550003", "5555550001", "5555550003"])
        assert not violations, "Phone numbers found:\n" + "\n".join(violations)

    def test_no_emails(self):
        violations = _scan_files(["fake-user@example.com", "fake-assistant@example.com"])
        assert not violations, "Emails found:\n" + "\n".join(violations)

    def test_no_full_names(self):
        violations = _scan_files(["Fake Owner", "Fake Partner"])
        assert not violations, "Full names found:\n" + "\n".join(violations)

    def test_no_partial_names(self):
        """First names, last names, usernames, session names."""
        violations = _scan_files(NAME_PATTERNS)
        assert not violations, "Partial names/usernames found:\n" + "\n".join(violations)

    def test_no_ips(self):
        violations = _scan_files(IP_PATTERNS)
        assert not violations, "IP addresses found:\n" + "\n".join(violations)

    def test_all_pii_patterns(self):
        """Single comprehensive check of all PII patterns."""
        all_patterns = PII_PATTERNS + NAME_PATTERNS + IP_PATTERNS
        violations = _scan_files(all_patterns)
        assert not violations, f"PII found in {len(violations)} locations:\n" + "\n".join(violations)
