"""Tests that skills are properly located in the repo and symlinked."""

import os
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).parent.parent.parent
SKILLS_DIR = REPO_ROOT / "skills"
HOME_SKILLS = Path.home() / ".claude" / "skills"


class TestSkillsInRepo:
    def test_skills_dir_exists(self):
        assert SKILLS_DIR.exists(), "skills/ directory must exist in repo"

    def test_skills_dir_has_skills(self):
        skill_dirs = [d for d in SKILLS_DIR.iterdir() if d.is_dir() and d.name != "__pycache__"]
        assert len(skill_dirs) >= 10, f"Expected 10+ skills, found {len(skill_dirs)}"

    def test_home_skills_is_symlink(self):
        assert HOME_SKILLS.is_symlink(), "~/.claude/skills should be a symlink to the repo"

    def test_home_skills_points_to_repo(self):
        target = HOME_SKILLS.resolve()
        expected = SKILLS_DIR.resolve()
        assert target == expected, f"Symlink points to {target}, expected {expected}"

    def test_each_skill_has_skill_md(self):
        """Every skill directory should have a SKILL.md."""
        skill_dirs = [d for d in SKILLS_DIR.iterdir() if d.is_dir() and d.name not in ("__pycache__", "_lib")]
        missing = []
        for d in skill_dirs:
            if not (d / "SKILL.md").exists():
                missing.append(d.name)
        assert not missing, f"Skills missing SKILL.md: {missing}"

    def test_skill_md_has_frontmatter(self):
        """Every SKILL.md should have YAML frontmatter with name and description."""
        skill_dirs = [d for d in SKILLS_DIR.iterdir() if d.is_dir() and d.name not in ("__pycache__", "_lib")]
        bad = []
        for d in skill_dirs:
            skill_md = d / "SKILL.md"
            if skill_md.exists():
                content = skill_md.read_text()
                if not content.startswith("---"):
                    bad.append(d.name)
        assert not bad, f"Skills with SKILL.md missing frontmatter: {bad}"

    def test_expected_skills_present(self):
        """Core skills that should always exist."""
        expected = [
            "sms-assistant", "chrome-control", "hue", "lutron", "sonos",
            "contacts", "memory", "podcast", "tts",
        ]
        for name in expected:
            assert (SKILLS_DIR / name).is_dir(), f"Expected skill {name} not found"


class TestSkillsNoPII:
    """Skills should not contain hardcoded PII."""

    PII_PATTERNS = [
        "+15555550001", "+15555550003",
        "nsthorat@gmail.com", "nicklaudethorat@gmail.com",
        "10.10.10.23", "10.10.10.62", "10.10.10.22",
    ]

    def test_skill_md_files_no_pii(self):
        """No SKILL.md should contain hardcoded PII."""
        violations = []
        for skill_md in SKILLS_DIR.rglob("SKILL.md"):
            content = skill_md.read_text()
            for pattern in self.PII_PATTERNS:
                if pattern in content:
                    violations.append(f"{skill_md.relative_to(SKILLS_DIR)}: {pattern}")
        assert not violations, f"PII found in SKILL.md files:\n" + "\n".join(violations)

    def test_skill_scripts_no_pii(self):
        """No skill script should contain hardcoded PII."""
        violations = []
        for scripts_dir in SKILLS_DIR.glob("*/scripts"):
            for script in scripts_dir.iterdir():
                if script.is_file():
                    try:
                        content = script.read_text()
                    except UnicodeDecodeError:
                        continue
                    for pattern in self.PII_PATTERNS:
                        if pattern in content:
                            violations.append(f"{script.relative_to(SKILLS_DIR)}: {pattern}")
        assert not violations, f"PII found in skill scripts:\n" + "\n".join(violations)
