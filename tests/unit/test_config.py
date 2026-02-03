"""Exhaustive unit tests for assistant/config.py."""

import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

# We need to test config in isolation, so we import and reset state each time
from assistant import config


@pytest.fixture(autouse=True)
def reset_config():
    """Reset config module state before each test."""
    config._config = {}
    config._loaded = False
    yield
    config._config = {}
    config._loaded = False


@pytest.fixture
def config_dir(tmp_path):
    """Create a temp dir with a config.local.yaml."""
    return tmp_path


def write_config(config_dir, data: dict) -> Path:
    """Write a config.local.yaml in the given dir and return its path."""
    p = config_dir / "config.local.yaml"
    p.write_text(yaml.dump(data))
    return p


class TestLoad:
    def test_load_valid_config(self, config_dir):
        data = {"owner": {"name": "Test User", "phone": "+15551234567"}}
        cfg_file = write_config(config_dir, data)
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result = config.load()
        assert result == data

    def test_load_missing_file_raises(self, tmp_path):
        missing = tmp_path / "nonexistent.yaml"
        with patch.object(config, "LOCAL_CONFIG_FILE", missing):
            with pytest.raises(FileNotFoundError, match="Required config file not found"):
                config.load()

    def test_load_caches_result(self, config_dir):
        data = {"owner": {"name": "Test"}}
        cfg_file = write_config(config_dir, data)
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result1 = config.load()
            # Modify file — should NOT be re-read due to caching
            write_config(config_dir, {"owner": {"name": "Changed"}})
            result2 = config.load()
        assert result1 is result2
        assert result2["owner"]["name"] == "Test"

    def test_load_empty_yaml_returns_empty_dict(self, config_dir):
        cfg_file = config_dir / "config.local.yaml"
        cfg_file.write_text("")  # empty YAML parses as None
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result = config.load()
        assert result == {}

    def test_load_yaml_with_only_comments(self, config_dir):
        cfg_file = config_dir / "config.local.yaml"
        cfg_file.write_text("# just a comment\n")
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            result = config.load()
        assert result == {}


class TestGet:
    def test_get_top_level_key(self, config_dir):
        cfg_file = write_config(config_dir, {"signal": {"account": "+1234"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("signal") == {"account": "+1234"}

    def test_get_nested_key(self, config_dir):
        cfg_file = write_config(config_dir, {"owner": {"name": "Alice", "phone": "+1"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("owner.name") == "Alice"
            assert config.get("owner.phone") == "+1"

    def test_get_deeply_nested(self, config_dir):
        cfg_file = write_config(config_dir, {"hue": {"bridges": {"home": {"ip": "10.0.0.1"}}}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("hue.bridges.home.ip") == "10.0.0.1"

    def test_get_missing_returns_default(self, config_dir):
        cfg_file = write_config(config_dir, {"owner": {"name": "Test"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("nonexistent") is None
            assert config.get("nonexistent", "fallback") == "fallback"
            assert config.get("owner.missing_field") is None
            assert config.get("owner.missing_field", 42) == 42

    def test_get_missing_intermediate_returns_default(self, config_dir):
        cfg_file = write_config(config_dir, {"owner": {"name": "Test"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("nonexistent.deep.path") is None
            assert config.get("nonexistent.deep.path", "x") == "x"

    def test_get_returns_none_not_dict_traversal(self, config_dir):
        """If we hit a non-dict value mid-path, return default."""
        cfg_file = write_config(config_dir, {"owner": {"name": "Test"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            # owner.name is a string, can't traverse further
            assert config.get("owner.name.something") is None

    def test_get_with_integer_values(self, config_dir):
        cfg_file = write_config(config_dir, {"port": 8080, "nested": {"count": 0}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("port") == 8080
            assert config.get("nested.count") == 0

    def test_get_with_boolean_values(self, config_dir):
        cfg_file = write_config(config_dir, {"enabled": True, "debug": False})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("enabled") is True
            assert config.get("debug") is False

    def test_get_with_list_values(self, config_dir):
        cfg_file = write_config(config_dir, {"items": [1, 2, 3]})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("items") == [1, 2, 3]


class TestRequire:
    def test_require_existing_value(self, config_dir):
        cfg_file = write_config(config_dir, {"owner": {"phone": "+1234"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.require("owner.phone") == "+1234"

    def test_require_missing_raises(self, config_dir):
        cfg_file = write_config(config_dir, {"owner": {"name": "Test"}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            with pytest.raises(ValueError, match="Required config.*missing or falsy"):
                config.require("owner.phone")

    def test_require_none_value_raises(self, config_dir):
        cfg_file = write_config(config_dir, {"owner": {"phone": None}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            with pytest.raises(ValueError, match="missing or falsy"):
                config.require("owner.phone")

    def test_require_empty_string_raises(self, config_dir):
        cfg_file = write_config(config_dir, {"owner": {"phone": ""}})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            with pytest.raises(ValueError, match="missing or falsy"):
                config.require("owner.phone")

    def test_require_zero_raises(self, config_dir):
        """0 is falsy — require() should reject it."""
        cfg_file = write_config(config_dir, {"port": 0})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            with pytest.raises(ValueError, match="missing or falsy"):
                config.require("port")

    def test_require_false_raises(self, config_dir):
        cfg_file = write_config(config_dir, {"enabled": False})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            with pytest.raises(ValueError, match="missing or falsy"):
                config.require("enabled")

    def test_require_truthy_values_pass(self, config_dir):
        cfg_file = write_config(config_dir, {
            "name": "Test",
            "count": 42,
            "items": [1],
            "flag": True,
        })
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.require("name") == "Test"
            assert config.require("count") == 42
            assert config.require("items") == [1]
            assert config.require("flag") is True


class TestReload:
    def test_reload_rereads_file(self, config_dir):
        cfg_file = write_config(config_dir, {"version": 1})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("version") == 1
            write_config(config_dir, {"version": 2})
            config.reload()
            assert config.get("version") == 2

    def test_reload_resets_loaded_flag(self, config_dir):
        cfg_file = write_config(config_dir, {"x": 1})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            config.load()
            assert config._loaded is True
            config.reload()
            assert config._loaded is True  # reload calls load() which sets it


class TestEdgeCases:
    def test_unicode_values(self, config_dir):
        cfg_file = write_config(config_dir, {"name": "日本語テスト", "emoji": "🎉"})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("name") == "日本語テスト"
            assert config.get("emoji") == "🎉"

    def test_special_characters_in_values(self, config_dir):
        cfg_file = write_config(config_dir, {"path": "/tmp/foo bar/baz", "url": "https://example.com?a=1&b=2"})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("path") == "/tmp/foo bar/baz"
            assert config.get("url") == "https://example.com?a=1&b=2"

    def test_single_dot_path(self, config_dir):
        """Single key with no dots."""
        cfg_file = write_config(config_dir, {"simple": "value"})
        with patch.object(config, "LOCAL_CONFIG_FILE", cfg_file):
            assert config.get("simple") == "value"

    def test_config_local_yaml_path(self):
        """Verify LOCAL_CONFIG_FILE points to the right place."""
        expected = Path(__file__).parent.parent.parent / "config.local.yaml"
        assert config.LOCAL_CONFIG_FILE == expected

    def test_assistant_dir_path(self):
        """Verify ASSISTANT_DIR is the repo root."""
        expected = Path(__file__).parent.parent.parent
        assert config.ASSISTANT_DIR == expected
