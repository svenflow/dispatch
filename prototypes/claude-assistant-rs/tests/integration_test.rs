//! Integration tests for the Claude Assistant daemon
//!
//! These tests verify end-to-end functionality of the daemon components.

use claude_assistant_rs::config::Config;
use claude_assistant_rs::contacts::normalize_phone;
use claude_assistant_rs::health::{check_session_content, HealthStatus, UnhealthyReason};
use claude_assistant_rs::messages::MessagesReader;
use claude_assistant_rs::registry::SessionRegistry;
use claude_assistant_rs::reminder::ReminderManager;
use claude_assistant_rs::session::SessionManager;
use tempfile::TempDir;

/// Test the full flow from contact lookup to session creation
#[test]
fn test_registry_workflow() {
    let temp_dir = TempDir::new().unwrap();
    let config = Config::for_test(temp_dir.path());
    let mut registry = SessionRegistry::new(&config);

    // Register a session
    let session = registry
        .register(
            "+16175551234",
            "john-doe",
            &format!("{}/john-doe", temp_dir.path().display()),
            "individual",
            Some("John Doe".to_string()),
            None,
            Some("admin".to_string()),
            None,
        )
        .unwrap();

    assert_eq!(session.chat_id, "+16175551234");
    assert_eq!(session.session_name, "john-doe");

    // Look up by chat_id
    let found = registry.get("+16175551234");
    assert!(found.is_some());
    assert_eq!(found.unwrap().contact_name, Some("John Doe".to_string()));

    // Look up by session name
    let found = registry.get_by_session_name("john-doe");
    assert!(found.is_some());

    // Persist and reload
    let mut registry2 = SessionRegistry::new(&config);
    let count = registry2.load().unwrap();
    assert_eq!(count, 1);

    let found = registry2.get("+16175551234");
    assert!(found.is_some());
    assert_eq!(found.unwrap().tier, Some("admin".to_string()));
}

/// Test phone number normalization edge cases
#[test]
fn test_phone_normalization_comprehensive() {
    // Standard formats
    assert_eq!(normalize_phone("+16175551234"), "+16175551234");
    assert_eq!(normalize_phone("6175551234"), "+16175551234");
    assert_eq!(normalize_phone("16175551234"), "+16175551234");

    // With formatting
    assert_eq!(normalize_phone("(617) 555-1234"), "+16175551234");
    assert_eq!(normalize_phone("617.555.1234"), "+16175551234");
    assert_eq!(normalize_phone("+1 (617) 555-1234"), "+16175551234");

    // International
    assert_eq!(normalize_phone("+447911123456"), "+447911123456");
}

/// Test health check patterns
#[test]
fn test_health_check_patterns_comprehensive() {
    // Healthy content
    assert_eq!(
        check_session_content("Claude is working on your task..."),
        HealthStatus::Healthy
    );

    // Various fatal errors
    let fatal_cases = vec![
        ("Traceback (most recent call last):\n  File...", "python_traceback"),
        ("panic: runtime error", "panic"),
        ("Segmentation fault", "segfault"),
        ("Session has crashed", "crashed"),
        ("Run /rewind to recover", "needs_rewind"),
        ("tool use concurrency error", "tool_concurrency"),
        ("JavaScript heap out of memory", "oom"),
    ];

    for (content, expected_pattern) in fatal_cases {
        match check_session_content(content) {
            HealthStatus::Unhealthy(UnhealthyReason::FatalError(pattern)) => {
                assert_eq!(
                    pattern, expected_pattern,
                    "Content '{}' should match pattern '{}'",
                    content, expected_pattern
                );
            }
            other => panic!(
                "Expected FatalError for '{}', got {:?}",
                content, other
            ),
        }
    }
}

/// Test reminder scheduling
#[test]
fn test_reminder_scheduling_comprehensive() {
    let mut manager = ReminderManager::new();

    // Complex reminder format
    let notes = r#"
Contact notes: Always friendly
Likes: Coffee, Books

REMINDER: 30 8 * * 1-5 | Weekday morning check-in
REMINDER: 0 12 * * 6 | Saturday lunch reminder
REMINDER: 0 0 1 * * | Monthly report due

More notes here.
"#;

    manager.register("+16175551234", notes);
    assert!(manager.has_reminders("+16175551234"));
    assert_eq!(manager.count(), 3);

    let reminders = manager.get("+16175551234").unwrap();
    assert_eq!(reminders[0].prompt, "Weekday morning check-in");
    assert_eq!(reminders[1].prompt, "Saturday lunch reminder");
    assert_eq!(reminders[2].prompt, "Monthly report due");
}

/// Test session name generation
#[test]
fn test_session_name_generation() {
    // Individual contacts
    assert_eq!(
        SessionManager::session_name_for_contact("John Doe"),
        "john-doe"
    );
    assert_eq!(
        SessionManager::session_name_for_contact("Mary Jane Watson"),
        "mary-jane-watson"
    );
    assert_eq!(
        SessionManager::session_name_for_contact("alice"),
        "alice"
    );

    // Group chats
    assert_eq!(
        SessionManager::session_name_for_group("abc123def456", Some("Family Chat")),
        "group-family_chat"
    );
    assert_eq!(
        SessionManager::session_name_for_group("abc123def456", None),
        "group-abc123def456"
    );

    // Special characters in group name
    assert_eq!(
        SessionManager::session_name_for_group("xxx", Some("Test & Group!")),
        "group-test___group_"
    );
}

/// Test that registry handles concurrent updates correctly
#[test]
fn test_registry_update_preserves_created_at() {
    let temp_dir = TempDir::new().unwrap();
    let config = Config::for_test(temp_dir.path());
    let mut registry = SessionRegistry::new(&config);

    // Initial registration
    let session1 = registry
        .register(
            "+16175551234",
            "test-user",
            "/tmp/test",
            "individual",
            Some("Test User".to_string()),
            None,
            Some("admin".to_string()),
            None,
        )
        .unwrap();

    let created_at = session1.created_at;

    // Small delay to ensure different timestamp
    std::thread::sleep(std::time::Duration::from_millis(10));

    // Update the same session
    let session2 = registry
        .register(
            "+16175551234",
            "test-user-updated",
            "/tmp/test",
            "individual",
            Some("Test User Updated".to_string()),
            None,
            Some("wife".to_string()),
            None,
        )
        .unwrap();

    // created_at should be preserved
    assert_eq!(session2.created_at, created_at);
    // updated_at should be different
    assert!(session2.updated_at > created_at);
    // Other fields should be updated
    assert_eq!(session2.session_name, "test-user-updated");
    assert_eq!(session2.tier, Some("wife".to_string()));
}

/// Test error handling for missing database
#[test]
fn test_messages_reader_handles_missing_db() {
    let temp_dir = TempDir::new().unwrap();
    let config = Config::for_test(temp_dir.path());

    let reader = MessagesReader::new(&config);
    // Should return error when DB doesn't exist
    let result = reader.get_new_messages(0);
    assert!(result.is_err());
}

/// Test config default paths
#[test]
fn test_config_paths() {
    let config = Config::default();

    // Should contain expected path components
    assert!(config.messages_db.to_string_lossy().contains("Messages"));
    assert!(config.transcripts_dir.to_string_lossy().contains("transcripts"));
    assert!(config.tmux.to_string_lossy().contains("tmux"));
    assert!(config.claude.to_string_lossy().contains("claude"));
}

/// Test blessed tier checking
#[test]
fn test_blessed_tiers() {
    use claude_assistant_rs::contacts::ContactsManager;

    assert!(ContactsManager::is_blessed_tier("admin"));
    assert!(ContactsManager::is_blessed_tier("wife"));
    assert!(ContactsManager::is_blessed_tier("family"));
    assert!(ContactsManager::is_blessed_tier("favorite"));

    assert!(!ContactsManager::is_blessed_tier("unknown"));
    assert!(!ContactsManager::is_blessed_tier(""));
    assert!(!ContactsManager::is_blessed_tier("ADMIN")); // case-sensitive
}

/// Test registry group session handling
#[test]
fn test_registry_group_session() {
    let temp_dir = TempDir::new().unwrap();
    let config = Config::for_test(temp_dir.path());
    let mut registry = SessionRegistry::new(&config);

    // Register a group session
    let session = registry
        .register(
            "abc123def456789012345",
            "group-family",
            "/tmp/group",
            "group",
            None,
            Some("Family Chat".to_string()),
            None,
            Some(vec![
                "Alice".to_string(),
                "Bob".to_string(),
                "Charlie".to_string(),
            ]),
        )
        .unwrap();

    assert_eq!(session.session_type, "group");
    assert_eq!(session.display_name, Some("Family Chat".to_string()));
    assert_eq!(session.participants.as_ref().unwrap().len(), 3);

    // Verify persistence
    let mut registry2 = SessionRegistry::new(&config);
    registry2.load().unwrap();

    let found = registry2.get("abc123def456789012345").unwrap();
    assert_eq!(found.session_type, "group");
    assert!(found.participants.is_some());
}
