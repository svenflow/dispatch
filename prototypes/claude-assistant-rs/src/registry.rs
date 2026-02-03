//! Session registry - persistent JSON storage for session metadata

use crate::config::Config;
use crate::error::{Error, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tempfile::NamedTempFile;
use std::io::Write;

/// Session metadata stored in registry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub chat_id: String,
    pub session_name: String,
    pub transcript_dir: String,
    #[serde(rename = "type")]
    pub session_type: String, // "individual" or "group"
    pub contact_name: Option<String>,
    pub display_name: Option<String>,
    pub tier: Option<String>,
    pub participants: Option<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_time: Option<DateTime<Utc>>,
}

/// Persistent registry mapping chat_id to session metadata
pub struct SessionRegistry {
    registry_path: PathBuf,
    data: HashMap<String, SessionData>,
}

impl SessionRegistry {
    pub fn new(config: &Config) -> Self {
        let registry_path = config.registry_file.clone();
        Self {
            registry_path,
            data: HashMap::new(),
        }
    }

    /// Load registry from disk
    pub fn load(&mut self) -> Result<usize> {
        if !self.registry_path.exists() {
            self.data = HashMap::new();
            return Ok(0);
        }

        let content = fs::read_to_string(&self.registry_path)?;
        self.data = serde_json::from_str(&content)?;
        Ok(self.data.len())
    }

    /// Save registry to disk atomically
    pub fn save(&self) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = self.registry_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Write to temp file in same directory (for atomic rename)
        let parent = self.registry_path.parent().unwrap_or(std::path::Path::new("."));
        let mut temp = NamedTempFile::new_in(parent)?;

        let json = serde_json::to_string_pretty(&self.data)?;
        temp.write_all(json.as_bytes())?;
        temp.as_file().sync_all()?;

        // Atomic rename
        temp.persist(&self.registry_path)
            .map_err(|e| Error::Io(e.error))?;

        Ok(())
    }

    /// Register or update a session
    pub fn register(
        &mut self,
        chat_id: &str,
        session_name: &str,
        transcript_dir: &str,
        session_type: &str,
        contact_name: Option<String>,
        display_name: Option<String>,
        tier: Option<String>,
        participants: Option<Vec<String>>,
    ) -> Result<SessionData> {
        let now = Utc::now();

        let existing = self.data.get(chat_id);
        let created_at = existing
            .map(|e| e.created_at)
            .unwrap_or(now);

        let session_data = SessionData {
            chat_id: chat_id.to_string(),
            session_name: session_name.to_string(),
            transcript_dir: transcript_dir.to_string(),
            session_type: session_type.to_string(),
            contact_name,
            display_name,
            tier,
            participants,
            created_at,
            updated_at: now,
            last_message_time: existing.and_then(|e| e.last_message_time),
        };

        self.data.insert(chat_id.to_string(), session_data.clone());
        self.save()?;

        Ok(session_data)
    }

    /// Get session data by chat_id
    pub fn get(&self, chat_id: &str) -> Option<&SessionData> {
        self.data.get(chat_id)
    }

    /// Get session data by session_name (reverse lookup)
    pub fn get_by_session_name(&self, session_name: &str) -> Option<&SessionData> {
        self.data.values().find(|d| d.session_name == session_name)
    }

    /// Get all registered sessions
    pub fn all(&self) -> &HashMap<String, SessionData> {
        &self.data
    }

    /// Update last message time
    pub fn update_last_message(&mut self, chat_id: &str) -> Result<()> {
        if let Some(session) = self.data.get_mut(chat_id) {
            session.last_message_time = Some(Utc::now());
            session.updated_at = Utc::now();
            self.save()?;
        }
        Ok(())
    }

    /// Remove a session from registry
    pub fn remove(&mut self, chat_id: &str) -> Result<Option<SessionData>> {
        let removed = self.data.remove(chat_id);
        if removed.is_some() {
            self.save()?;
        }
        Ok(removed)
    }

    /// Get number of registered sessions
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Check if registry is empty
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_config(temp_dir: &TempDir) -> Config {
        Config::for_test(temp_dir.path())
    }

    #[test]
    fn test_registry_create_and_load() {
        let temp_dir = TempDir::new().unwrap();
        let config = test_config(&temp_dir);

        // Create registry and register a session
        let mut registry = SessionRegistry::new(&config);
        registry
            .register(
                "+16175551234",
                "test-user",
                "/tmp/transcripts/test-user",
                "individual",
                Some("Test User".to_string()),
                None,
                Some("admin".to_string()),
                None,
            )
            .unwrap();

        assert_eq!(registry.len(), 1);

        // Create new registry instance and load
        let mut registry2 = SessionRegistry::new(&config);
        let count = registry2.load().unwrap();
        assert_eq!(count, 1);

        let session = registry2.get("+16175551234").unwrap();
        assert_eq!(session.session_name, "test-user");
        assert_eq!(session.tier, Some("admin".to_string()));
    }

    #[test]
    fn test_registry_update() {
        let temp_dir = TempDir::new().unwrap();
        let config = test_config(&temp_dir);
        let mut registry = SessionRegistry::new(&config);

        // Register
        registry
            .register(
                "+16175551234",
                "test-user",
                "/tmp/test",
                "individual",
                Some("Test".to_string()),
                None,
                Some("admin".to_string()),
                None,
            )
            .unwrap();

        let first_created = registry.get("+16175551234").unwrap().created_at;

        // Update (same chat_id)
        std::thread::sleep(std::time::Duration::from_millis(10));
        registry
            .register(
                "+16175551234",
                "test-user-updated",
                "/tmp/test",
                "individual",
                Some("Test Updated".to_string()),
                None,
                Some("wife".to_string()),
                None,
            )
            .unwrap();

        // created_at should be preserved
        let session = registry.get("+16175551234").unwrap();
        assert_eq!(session.created_at, first_created);
        assert_eq!(session.session_name, "test-user-updated");
        assert_eq!(session.tier, Some("wife".to_string()));
    }

    #[test]
    fn test_registry_get_by_session_name() {
        let temp_dir = TempDir::new().unwrap();
        let config = test_config(&temp_dir);
        let mut registry = SessionRegistry::new(&config);

        registry
            .register(
                "+16175551234",
                "nikhil-thorat",
                "/tmp/test",
                "individual",
                Some("Nikhil Thorat".to_string()),
                None,
                Some("admin".to_string()),
                None,
            )
            .unwrap();

        let session = registry.get_by_session_name("nikhil-thorat");
        assert!(session.is_some());
        assert_eq!(session.unwrap().chat_id, "+16175551234");

        let not_found = registry.get_by_session_name("unknown");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_registry_remove() {
        let temp_dir = TempDir::new().unwrap();
        let config = test_config(&temp_dir);
        let mut registry = SessionRegistry::new(&config);

        registry
            .register(
                "+16175551234",
                "test",
                "/tmp/test",
                "individual",
                None,
                None,
                None,
                None,
            )
            .unwrap();

        assert_eq!(registry.len(), 1);

        let removed = registry.remove("+16175551234").unwrap();
        assert!(removed.is_some());
        assert_eq!(registry.len(), 0);

        // Remove non-existent
        let removed2 = registry.remove("+16175551234").unwrap();
        assert!(removed2.is_none());
    }

    #[test]
    fn test_registry_group_session() {
        let temp_dir = TempDir::new().unwrap();
        let config = test_config(&temp_dir);
        let mut registry = SessionRegistry::new(&config);

        registry
            .register(
                "abc123def456",
                "group-family",
                "/tmp/group",
                "group",
                None,
                Some("Family Chat".to_string()),
                None,
                Some(vec!["Alice".to_string(), "Bob".to_string()]),
            )
            .unwrap();

        let session = registry.get("abc123def456").unwrap();
        assert_eq!(session.session_type, "group");
        assert_eq!(session.display_name, Some("Family Chat".to_string()));
        assert_eq!(
            session.participants,
            Some(vec!["Alice".to_string(), "Bob".to_string()])
        );
    }

    #[test]
    fn test_registry_last_message_time() {
        let temp_dir = TempDir::new().unwrap();
        let config = test_config(&temp_dir);
        let mut registry = SessionRegistry::new(&config);

        registry
            .register(
                "+16175551234",
                "test",
                "/tmp/test",
                "individual",
                None,
                None,
                None,
                None,
            )
            .unwrap();

        // Initially no last_message_time
        let session = registry.get("+16175551234").unwrap();
        assert!(session.last_message_time.is_none());

        // Update
        registry.update_last_message("+16175551234").unwrap();

        let session = registry.get("+16175551234").unwrap();
        assert!(session.last_message_time.is_some());
    }

    #[test]
    fn test_session_data_serialization() {
        let session = SessionData {
            chat_id: "+16175551234".to_string(),
            session_name: "test-user".to_string(),
            transcript_dir: "/tmp/test".to_string(),
            session_type: "individual".to_string(),
            contact_name: Some("Test User".to_string()),
            display_name: None,
            tier: Some("admin".to_string()),
            participants: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_message_time: None,
        };

        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("test-user"));
        assert!(json.contains("individual"));

        // Deserialize back
        let parsed: SessionData = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.chat_id, session.chat_id);
        assert_eq!(parsed.session_name, session.session_name);
    }
}
