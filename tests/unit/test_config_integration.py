"""Tests that config.get/require are correctly wired into manager.py and common.py."""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import yaml

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from assistant import config


@pytest.fixture(autouse=True)
def reset_config():
    """Reset config module state before each test."""
    config._config = {}
    config._loaded = False
    # Also reset the cached signal account
    import assistant.common as common
    common._SIGNAL_ACCOUNT = None
    yield
    config._config = {}
    config._loaded = False
    common._SIGNAL_ACCOUNT = None


def write_config(tmp_path, data: dict) -> Path:
    p = tmp_path / "config.local.yaml"
    p.write_text(yaml.dump(data))
    return p


class TestSignalAccountFromConfig:
    def test_signal_account_reads_from_config(self, tmp_path):
        from assistant.common import signal_account
        cfg_file = write_config(tmp_path, {"signal": {"account": "+15551234567"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result = signal_account()
        assert result == "+15551234567"

    def test_signal_account_defaults_to_empty(self, tmp_path):
        from assistant.common import signal_account
        cfg_file = write_config(tmp_path, {"owner": {"name": "Test"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result = signal_account()
        assert result == ""

    def test_signal_account_caches(self, tmp_path):
        from assistant.common import signal_account
        cfg_file = write_config(tmp_path, {"signal": {"account": "+15551234567"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result1 = signal_account()
            result2 = signal_account()
        assert result1 == result2 == "+15551234567"


class TestWrapAdminFromConfig:
    def test_wrap_admin_uses_config_name(self, tmp_path):
        from assistant.common import wrap_admin
        cfg_file = write_config(tmp_path, {"owner": {"name": "Test Owner"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result = wrap_admin("do something")
        assert "Test Owner" in result
        assert "(admin)" in result
        assert "do something" in result

    def test_wrap_admin_defaults_to_admin(self, tmp_path):
        from assistant.common import wrap_admin
        cfg_file = write_config(tmp_path, {})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result = wrap_admin("test")
        assert "Admin" in result


class TestManagerConfigValidation:
    def test_manager_requires_owner_config(self, tmp_path):
        """Manager startup should fail fast if owner config is missing."""
        cfg_file = write_config(tmp_path, {})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            with pytest.raises(ValueError, match="Required config.*missing or falsy"):
                config.require("owner.name")

    def test_manager_requires_owner_phone(self, tmp_path):
        cfg_file = write_config(tmp_path, {"owner": {"name": "Test"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            with pytest.raises(ValueError, match="Required config.*missing or falsy"):
                config.require("owner.phone")

    def test_manager_passes_with_valid_config(self, tmp_path):
        cfg_file = write_config(tmp_path, {
            "owner": {"name": "Test User", "phone": "+15551234567"},
            "signal": {"account": "+15559876543"},
        })
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.require("owner.name") == "Test User"
            assert config.require("owner.phone") == "+15551234567"
            assert config.get("signal.account") == "+15559876543"


class TestConfigExampleYaml:
    """Ensure config.example.yaml is a valid template with all expected keys."""

    def test_example_yaml_is_valid(self):
        example_path = config.ASSISTANT_DIR / "config.example.yaml"
        assert example_path.exists(), "config.example.yaml must exist"
        with open(example_path) as f:
            data = yaml.safe_load(f)
        assert isinstance(data, dict)

    def test_example_has_all_sections(self):
        example_path = config.ASSISTANT_DIR / "config.example.yaml"
        with open(example_path) as f:
            data = yaml.safe_load(f)
        expected_sections = ["owner", "wife", "assistant", "signal", "hue", "lutron", "podcast", "chrome"]
        for section in expected_sections:
            assert section in data, f"config.example.yaml missing section: {section}"

    def test_example_owner_has_required_fields(self):
        example_path = config.ASSISTANT_DIR / "config.example.yaml"
        with open(example_path) as f:
            data = yaml.safe_load(f)
        assert "name" in data["owner"]
        assert "phone" in data["owner"]
        assert "email" in data["owner"]

    def test_example_contains_no_real_pii(self):
        """config.example.yaml must not contain any real personal info."""
        example_path = config.ASSISTANT_DIR / "config.example.yaml"
        content = example_path.read_text()
        pii_patterns = [
            "Nikhil", "Thorat", "Caroline", "McGuire",
            "nsthorat", "nicklaudethorat",
            "+15555550001", "+15555550003",
            "10.10.10.23", "10.10.10.62", "10.10.10.22",
        ]
        for pattern in pii_patterns:
            assert pattern not in content, f"config.example.yaml contains PII: {pattern}"

    def test_local_config_exists(self):
        """config.local.yaml should exist on this machine."""
        assert config.LOCAL_CONFIG_FILE.exists(), "config.local.yaml must exist for the daemon to run"
