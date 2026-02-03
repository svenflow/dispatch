"""Tests that .gitignore exists and covers critical patterns."""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent


class TestGitignore:
    def test_gitignore_exists(self):
        assert (REPO_ROOT / ".gitignore").exists()

    def test_gitignore_covers_config_local(self):
        content = (REPO_ROOT / ".gitignore").read_text()
        assert "config.local.yaml" in content

    def test_gitignore_covers_env(self):
        content = (REPO_ROOT / ".gitignore").read_text()
        assert ".env" in content

    def test_gitignore_covers_state(self):
        content = (REPO_ROOT / ".gitignore").read_text()
        assert "state/" in content

    def test_gitignore_covers_logs(self):
        content = (REPO_ROOT / ".gitignore").read_text()
        assert "logs/" in content

    def test_gitignore_covers_sessions(self):
        content = (REPO_ROOT / ".gitignore").read_text()
        assert "sessions/" in content

    def test_gitignore_covers_venv(self):
        content = (REPO_ROOT / ".gitignore").read_text()
        assert ".venv/" in content

    def test_gitignore_covers_pycache(self):
        content = (REPO_ROOT / ".gitignore").read_text()
        assert "__pycache__/" in content

    def test_gitignore_covers_secrets(self):
        content = (REPO_ROOT / ".gitignore").read_text()
        assert "secrets.env" in content

    def test_config_example_NOT_ignored(self):
        """config.example.yaml should be tracked (it's the template)."""
        content = (REPO_ROOT / ".gitignore").read_text()
        assert "config.example.yaml" not in content
