"""Conftest for live API tests that need the real claude_agent_sdk.

The parent conftest.py mocks claude_agent_sdk at import time. We undo that
here so these tests hit the real Claude API (via haiku for cost).
"""
import sys

# Remove the mock so the real SDK gets imported
if "claude_agent_sdk" in sys.modules:
    del sys.modules["claude_agent_sdk"]
