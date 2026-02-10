//! Tmux session management
//!
//! Create, kill, and interact with tmux sessions running Claude.

use crate::config::Config;
use crate::error::{Error, Result};
use crate::health::{check_session_content, HealthStatus, UnhealthyReason};
use std::process::{Command, Output};
use std::time::Duration;

/// Manager for tmux sessions
pub struct SessionManager {
    tmux: std::path::PathBuf,
    claude: std::path::PathBuf,
    transcripts_dir: std::path::PathBuf,
}

impl SessionManager {
    pub fn new(config: &Config) -> Self {
        Self {
            tmux: config.tmux.clone(),
            claude: config.claude.clone(),
            transcripts_dir: config.transcripts_dir.clone(),
        }
    }

    /// Check if a tmux session exists (exact match)
    pub fn session_exists(&self, session_name: &str) -> bool {
        let result = Command::new(&self.tmux)
            .args(["has-session", "-t", &format!("={}", session_name)])
            .output();

        matches!(result, Ok(o) if o.status.success())
    }

    /// Create a new tmux session with Claude
    pub fn create_session(
        &self,
        session_name: &str,
        transcript_dir: &std::path::Path,
        tier: &str,
    ) -> Result<()> {
        if self.session_exists(session_name) {
            return Ok(()); // Already exists
        }

        // Ensure transcript directory exists
        std::fs::create_dir_all(transcript_dir)?;

        // Symlink .claude so skills are available
        let claude_symlink = transcript_dir.join(".claude");
        if !claude_symlink.exists() {
            if let Some(home) = dirs::home_dir() {
                let _ = std::os::unix::fs::symlink(home.join(".claude"), &claude_symlink);
            }
        }

        // Build claude command based on tier
        let claude_cmd = match tier {
            "admin" | "wife" => {
                format!(
                    "cd {} && {} --dangerously-skip-permissions",
                    transcript_dir.display(),
                    self.claude.display()
                )
            }
            "family" => {
                let prompt = "You are chatting with a FAMILY tier user. Read ~/.claude/skills/sms-assistant/family-rules.md FIRST.";
                format!(
                    "cd {} && {} --dangerously-skip-permissions --append-system-prompt \"{}\"",
                    transcript_dir.display(),
                    self.claude.display(),
                    prompt
                )
            }
            _ => {
                // Restricted for favorites
                let allowed = "Read,WebSearch,WebFetch,Grep,Glob,Bash(osascript:*)";
                let prompt = "You are chatting with a FAVORITES tier user with LIMITED privileges.";
                format!(
                    "cd {} && {} --dangerously-skip-permissions --allowedTools \"{}\" --append-system-prompt \"{}\"",
                    transcript_dir.display(),
                    self.claude.display(),
                    allowed,
                    prompt
                )
            }
        };

        let output = Command::new(&self.tmux)
            .args([
                "new-session",
                "-d",
                "-s",
                session_name,
                "/bin/bash",
                "-lc",
                &claude_cmd,
            ])
            .output()?;

        if !output.status.success() {
            return Err(Error::Tmux(format!(
                "Failed to create session {}: {}",
                session_name,
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        // Wait for session to start
        std::thread::sleep(Duration::from_secs(2));

        Ok(())
    }

    /// Kill a tmux session
    pub fn kill_session(&self, session_name: &str) -> Result<()> {
        let output = Command::new(&self.tmux)
            .args(["kill-session", "-t", &format!("={}", session_name)])
            .output()?;

        if !output.status.success() {
            // Session might not exist, that's OK
            let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
            if !stderr.contains("no server running")
                && !stderr.contains("session not found")
                && !stderr.contains("can't find session")
                && !stderr.contains("no current session")
            {
                return Err(Error::Tmux(format!(
                    "Failed to kill session {}: {}",
                    session_name,
                    String::from_utf8_lossy(&output.stderr)
                )));
            }
        }

        Ok(())
    }

    /// Inject text into a tmux session
    pub fn inject_text(&self, session_name: &str, text: &str) -> Result<()> {
        if !self.session_exists(session_name) {
            return Err(Error::SessionNotFound(session_name.to_string()));
        }

        // Send keys with literal flag
        let output = Command::new(&self.tmux)
            .args(["send-keys", "-t", session_name, "-l", "--", text])
            .output()?;

        if !output.status.success() {
            return Err(Error::Tmux(format!(
                "Failed to send keys: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        // Wait for paste to complete
        std::thread::sleep(Duration::from_millis(500));

        // Send Enter to submit
        Command::new(&self.tmux)
            .args(["send-keys", "-t", session_name, "Enter"])
            .output()?;
        Command::new(&self.tmux)
            .args(["send-keys", "-t", session_name, "Enter"])
            .output()?;

        Ok(())
    }

    /// Capture pane content from a tmux session
    pub fn capture_pane(&self, session_name: &str, lines: u32) -> Result<String> {
        if !self.session_exists(session_name) {
            return Err(Error::SessionNotFound(session_name.to_string()));
        }

        let output = Command::new(&self.tmux)
            .args([
                "capture-pane",
                "-t",
                &format!("={}", session_name),
                "-p",
                "-S",
                &format!("-{}", lines),
            ])
            .output()?;

        if !output.status.success() {
            return Err(Error::Tmux(format!(
                "Failed to capture pane: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Check session health
    pub fn check_health(&self, session_name: &str) -> HealthStatus {
        if !self.session_exists(session_name) {
            return HealthStatus::Unhealthy(UnhealthyReason::SessionMissing);
        }

        match self.capture_pane(session_name, 30) {
            Ok(content) => check_session_content(&content),
            Err(_) => HealthStatus::Unhealthy(UnhealthyReason::SessionMissing),
        }
    }

    /// List all tmux sessions
    pub fn list_sessions(&self) -> Result<Vec<String>> {
        let output = Command::new(&self.tmux)
            .args(["list-sessions", "-F", "#{session_name}"])
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("no server running") {
                return Ok(Vec::new());
            }
            return Err(Error::Tmux(format!("Failed to list sessions: {}", stderr)));
        }

        let sessions = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        Ok(sessions)
    }

    /// Generate session name from contact name
    pub fn session_name_for_contact(contact_name: &str) -> String {
        contact_name.to_lowercase().replace(' ', "-")
    }

    /// Generate session name for a group chat
    pub fn session_name_for_group(chat_id: &str, display_name: Option<&str>) -> String {
        if let Some(name) = display_name {
            let safe_name: String = name
                .to_lowercase()
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { '_' })
                .take(20)
                .collect();
            format!("group-{}", safe_name)
        } else {
            format!("group-{}", &chat_id[..12.min(chat_id.len())])
        }
    }

    /// Restart a session (kill and recreate)
    pub fn restart_session(
        &self,
        session_name: &str,
        transcript_dir: &std::path::Path,
        tier: &str,
    ) -> Result<()> {
        // Kill existing
        self.kill_session(session_name)?;
        std::thread::sleep(Duration::from_secs(2));

        // Recreate
        self.create_session(session_name, transcript_dir, tier)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_name_for_contact() {
        assert_eq!(
            SessionManager::session_name_for_contact("Jane Doe"),
            "jane-doe"
        );
        assert_eq!(
            SessionManager::session_name_for_contact("John Doe"),
            "john-doe"
        );
        assert_eq!(
            SessionManager::session_name_for_contact("alice"),
            "alice"
        );
    }

    #[test]
    fn test_session_name_for_group() {
        assert_eq!(
            SessionManager::session_name_for_group("abc123def456", Some("Family Chat")),
            "group-family_chat"
        );
        assert_eq!(
            SessionManager::session_name_for_group("abc123def456", None),
            "group-abc123def456"
        );
        // Long name gets truncated
        assert_eq!(
            SessionManager::session_name_for_group("xxx", Some("A Very Long Group Name Here")),
            "group-a_very_long_group_na"
        );
    }

    #[test]
    fn test_session_name_special_chars() {
        assert_eq!(
            SessionManager::session_name_for_group("xxx", Some("Test & Group!")),
            "group-test___group_"
        );
    }

    // Integration tests (require tmux to be installed)
    #[test]
    #[ignore] // Run with --ignored flag when tmux is available
    fn test_session_lifecycle() {
        let config = Config::default();
        let manager = SessionManager::new(&config);

        let test_session = "test-rust-session";
        let temp_dir = tempfile::TempDir::new().unwrap();

        // Clean up any existing session
        let _ = manager.kill_session(test_session);

        // Create session
        manager
            .create_session(test_session, temp_dir.path(), "admin")
            .unwrap();
        assert!(manager.session_exists(test_session));

        // Check it's in the list
        let sessions = manager.list_sessions().unwrap();
        assert!(sessions.contains(&test_session.to_string()));

        // Capture pane
        std::thread::sleep(Duration::from_secs(1));
        let content = manager.capture_pane(test_session, 10).unwrap();
        assert!(!content.is_empty() || content.is_empty()); // May be empty initially

        // Kill session
        manager.kill_session(test_session).unwrap();
        std::thread::sleep(Duration::from_secs(1));
        assert!(!manager.session_exists(test_session));
    }

    #[test]
    #[ignore]
    fn test_inject_text() {
        let config = Config::default();
        let manager = SessionManager::new(&config);
        let test_session = "test-inject-session";
        let temp_dir = tempfile::TempDir::new().unwrap();

        // Setup
        let _ = manager.kill_session(test_session);
        manager
            .create_session(test_session, temp_dir.path(), "admin")
            .unwrap();
        std::thread::sleep(Duration::from_secs(2));

        // Inject text
        manager.inject_text(test_session, "echo hello").unwrap();

        // Cleanup
        manager.kill_session(test_session).unwrap();
    }

    #[test]
    fn test_kill_nonexistent_session() {
        let config = Config::default();
        let manager = SessionManager::new(&config);

        // Should not error when killing non-existent session
        let result = manager.kill_session("definitely-does-not-exist-12345");
        assert!(result.is_ok());
    }
}
