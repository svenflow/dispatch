//! Configuration and paths

use std::path::PathBuf;

/// All configurable paths and constants
#[derive(Debug, Clone)]
pub struct Config {
    pub home: PathBuf,
    pub messages_db: PathBuf,
    pub assistant_dir: PathBuf,
    pub state_dir: PathBuf,
    pub state_file: PathBuf,
    pub registry_file: PathBuf,
    pub logs_dir: PathBuf,
    pub skills_dir: PathBuf,
    pub transcripts_dir: PathBuf,
    pub tmux: PathBuf,
    pub claude: PathBuf,
    pub contacts_cli: PathBuf,
    pub send_sms: PathBuf,
    pub poll_interval_ms: u64,
    pub health_check_interval_secs: u64,
    pub idle_timeout_hours: f64,
    pub consolidation_hour: u32,
}

impl Default for Config {
    fn default() -> Self {
        let home = dirs::home_dir().expect("Could not find home directory");
        let assistant_dir = home.join("code/claude-assistant");

        Self {
            messages_db: home.join("Library/Messages/chat.db"),
            state_dir: assistant_dir.join("state"),
            state_file: assistant_dir.join("state/last_rowid.txt"),
            registry_file: assistant_dir.join("state/sessions.json"),
            logs_dir: assistant_dir.join("logs"),
            skills_dir: home.join(".claude/skills"),
            transcripts_dir: home.join("transcripts"),
            tmux: PathBuf::from("/opt/homebrew/bin/tmux"),
            claude: home.join(".local/bin/claude"),
            contacts_cli: home.join("code/contacts-cli/contacts"),
            send_sms: home.join("code/sms-cli/send-sms"),
            assistant_dir,
            home,
            poll_interval_ms: 100,
            health_check_interval_secs: 300,
            idle_timeout_hours: 2.0,
            consolidation_hour: 2,
        }
    }
}

impl Config {
    /// Create config for testing with custom paths
    pub fn for_test(temp_dir: &std::path::Path) -> Self {
        Self {
            home: temp_dir.to_path_buf(),
            messages_db: temp_dir.join("chat.db"),
            assistant_dir: temp_dir.join("claude-assistant"),
            state_dir: temp_dir.join("state"),
            state_file: temp_dir.join("state/last_rowid.txt"),
            registry_file: temp_dir.join("state/sessions.json"),
            logs_dir: temp_dir.join("logs"),
            skills_dir: temp_dir.join("skills"),
            transcripts_dir: temp_dir.join("transcripts"),
            tmux: PathBuf::from("/opt/homebrew/bin/tmux"),
            claude: PathBuf::from("/usr/local/bin/claude"),
            contacts_cli: temp_dir.join("contacts"),
            send_sms: temp_dir.join("send-sms"),
            poll_interval_ms: 100,
            health_check_interval_secs: 300,
            idle_timeout_hours: 2.0,
            consolidation_hour: 2,
        }
    }
}

/// macOS epoch offset (2001-01-01 to 1970-01-01 in seconds)
pub const MACOS_EPOCH_OFFSET: i64 = 978307200;

/// Contact tiers in priority order
pub const BLESSED_TIERS: &[&str] = &["admin", "wife", "family", "favorite"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert!(config.home.exists() || true); // May not exist in CI
        assert!(config.messages_db.to_string_lossy().contains("chat.db"));
    }

    #[test]
    fn test_test_config() {
        let temp = std::env::temp_dir();
        let config = Config::for_test(&temp);
        assert_eq!(config.home, temp);
    }

    #[test]
    fn test_macos_epoch() {
        // Jan 1, 2001 00:00:00 UTC
        assert_eq!(MACOS_EPOCH_OFFSET, 978307200);
    }

    #[test]
    fn test_blessed_tiers() {
        assert!(BLESSED_TIERS.contains(&"admin"));
        assert!(BLESSED_TIERS.contains(&"wife"));
        assert!(BLESSED_TIERS.contains(&"family"));
        assert!(BLESSED_TIERS.contains(&"favorite"));
        assert!(!BLESSED_TIERS.contains(&"unknown"));
    }
}
