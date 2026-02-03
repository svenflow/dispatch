//! Reminder polling using cron expressions
//!
//! Evaluates cron schedules from contact notes to determine when to inject reminders.

use crate::error::{Error, Result};
use chrono::{DateTime, Utc};
use cron::Schedule;
use regex::Regex;
use std::collections::HashMap;
use std::str::FromStr;

/// A parsed reminder from contact notes
#[derive(Debug, Clone)]
pub struct Reminder {
    pub cron_expr: String,
    pub schedule: Schedule,
    pub prompt: String,
}

/// Manages reminder schedules for contacts
pub struct ReminderManager {
    /// Map of chat_id -> Vec<Reminder>
    reminders: HashMap<String, Vec<Reminder>>,
    /// Last fire time per reminder (chat_id + index)
    last_fired: HashMap<String, DateTime<Utc>>,
}

impl ReminderManager {
    pub fn new() -> Self {
        Self {
            reminders: HashMap::new(),
            last_fired: HashMap::new(),
        }
    }

    /// Parse reminders from contact notes
    /// Format: REMINDER: <cron> | <prompt>
    /// Example: REMINDER: 0 9 * * * | Good morning! Time to check your tasks.
    pub fn parse_reminders(notes: &str) -> Vec<Reminder> {
        let pattern = Regex::new(r"(?m)^REMINDER:\s*(.+?)\s*\|\s*(.+)$").unwrap();
        let mut reminders = Vec::new();

        for cap in pattern.captures_iter(notes) {
            let cron_expr = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            let prompt = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");

            // Cron crate needs 6 fields (sec min hour dom month dow)
            // If user gives 5 fields, prepend "0" for seconds
            let full_cron = if cron_expr.split_whitespace().count() == 5 {
                format!("0 {}", cron_expr)
            } else {
                cron_expr.to_string()
            };

            match Schedule::from_str(&full_cron) {
                Ok(schedule) => {
                    reminders.push(Reminder {
                        cron_expr: cron_expr.to_string(),
                        schedule,
                        prompt: prompt.to_string(),
                    });
                }
                Err(e) => {
                    tracing::warn!("Invalid cron expression '{}': {}", cron_expr, e);
                }
            }
        }

        reminders
    }

    /// Register reminders for a contact
    pub fn register(&mut self, chat_id: &str, notes: &str) {
        let reminders = Self::parse_reminders(notes);
        if !reminders.is_empty() {
            self.reminders.insert(chat_id.to_string(), reminders);
        } else {
            self.reminders.remove(chat_id);
        }
    }

    /// Remove reminders for a contact
    pub fn unregister(&mut self, chat_id: &str) {
        self.reminders.remove(chat_id);
        // Clean up last_fired entries
        let prefix = format!("{}:", chat_id);
        self.last_fired.retain(|k, _| !k.starts_with(&prefix));
    }

    /// Check for due reminders and return (chat_id, prompt) pairs
    pub fn check_due(&mut self, now: DateTime<Utc>) -> Vec<(String, String)> {
        let mut due = Vec::new();

        for (chat_id, reminders) in &self.reminders {
            for (idx, reminder) in reminders.iter().enumerate() {
                let key = format!("{}:{}", chat_id, idx);

                // Get last fire time or epoch
                let last = self
                    .last_fired
                    .get(&key)
                    .copied()
                    .unwrap_or_else(|| DateTime::from_timestamp(0, 0).unwrap());

                // Check if there's a scheduled time between last and now
                if let Some(next) = reminder.schedule.after(&last).next() {
                    if next <= now {
                        due.push((chat_id.clone(), reminder.prompt.clone()));
                        // Update last_fired through mutable reference after loop
                    }
                }
            }
        }

        // Update last_fired for due reminders
        for (chat_id, _) in &due {
            for (idx, _) in self.reminders.get(chat_id).unwrap().iter().enumerate() {
                let key = format!("{}:{}", chat_id, idx);
                self.last_fired.insert(key, now);
            }
        }

        due
    }

    /// Get all registered reminders
    pub fn all(&self) -> &HashMap<String, Vec<Reminder>> {
        &self.reminders
    }

    /// Get reminders for a specific contact
    pub fn get(&self, chat_id: &str) -> Option<&Vec<Reminder>> {
        self.reminders.get(chat_id)
    }

    /// Check if a contact has reminders
    pub fn has_reminders(&self, chat_id: &str) -> bool {
        self.reminders.contains_key(chat_id)
    }

    /// Get count of all reminders
    pub fn count(&self) -> usize {
        self.reminders.values().map(|v| v.len()).sum()
    }
}

impl Default for ReminderManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Timelike};

    #[test]
    fn test_parse_single_reminder() {
        let notes = "REMINDER: 0 9 * * * | Good morning!";
        let reminders = ReminderManager::parse_reminders(notes);

        assert_eq!(reminders.len(), 1);
        assert_eq!(reminders[0].cron_expr, "0 9 * * *");
        assert_eq!(reminders[0].prompt, "Good morning!");
    }

    #[test]
    fn test_parse_multiple_reminders() {
        let notes = r#"
Some notes about the contact.

REMINDER: 0 9 * * 1-5 | Time for work standup
REMINDER: 0 18 * * * | Check evening tasks
REMINDER: 0 0 1 * * | Monthly review time

More notes here.
"#;
        let reminders = ReminderManager::parse_reminders(notes);

        assert_eq!(reminders.len(), 3);
        assert_eq!(reminders[0].prompt, "Time for work standup");
        assert_eq!(reminders[1].prompt, "Check evening tasks");
        assert_eq!(reminders[2].prompt, "Monthly review time");
    }

    #[test]
    fn test_parse_no_reminders() {
        let notes = "Just some regular notes without any reminders.";
        let reminders = ReminderManager::parse_reminders(notes);
        assert!(reminders.is_empty());
    }

    #[test]
    fn test_parse_invalid_cron() {
        let notes = "REMINDER: invalid cron | This won't parse";
        let reminders = ReminderManager::parse_reminders(notes);
        assert!(reminders.is_empty());
    }

    #[test]
    fn test_parse_six_field_cron() {
        // 6-field cron (with seconds)
        let notes = "REMINDER: 30 0 9 * * * | At 9:00:30";
        let reminders = ReminderManager::parse_reminders(notes);

        assert_eq!(reminders.len(), 1);
        assert_eq!(reminders[0].cron_expr, "30 0 9 * * *");
    }

    #[test]
    fn test_register_and_get() {
        let mut manager = ReminderManager::new();
        let notes = "REMINDER: 0 9 * * * | Morning";

        manager.register("+16175551234", notes);

        assert!(manager.has_reminders("+16175551234"));
        assert!(!manager.has_reminders("+16175559999"));

        let reminders = manager.get("+16175551234").unwrap();
        assert_eq!(reminders.len(), 1);
    }

    #[test]
    fn test_unregister() {
        let mut manager = ReminderManager::new();
        manager.register("+16175551234", "REMINDER: 0 9 * * * | Morning");

        assert!(manager.has_reminders("+16175551234"));

        manager.unregister("+16175551234");

        assert!(!manager.has_reminders("+16175551234"));
    }

    #[test]
    fn test_check_due_fires_once() {
        let mut manager = ReminderManager::new();

        // Every minute
        manager.register("+16175551234", "REMINDER: * * * * * | Ping");

        // First check at T=0
        let t0 = Utc.with_ymd_and_hms(2024, 1, 15, 10, 0, 0).unwrap();
        let due = manager.check_due(t0);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0, "+16175551234");
        assert_eq!(due[0].1, "Ping");

        // Second check at same time should not fire again
        let due2 = manager.check_due(t0);
        assert!(due2.is_empty());

        // Check at T+1 minute should fire
        let t1 = Utc.with_ymd_and_hms(2024, 1, 15, 10, 1, 0).unwrap();
        let due3 = manager.check_due(t1);
        assert_eq!(due3.len(), 1);
    }

    #[test]
    fn test_check_due_multiple_contacts() {
        let mut manager = ReminderManager::new();

        manager.register("+16175551111", "REMINDER: * * * * * | Ping A");
        manager.register("+16175552222", "REMINDER: * * * * * | Ping B");

        let now = Utc.with_ymd_and_hms(2024, 1, 15, 10, 0, 0).unwrap();
        let due = manager.check_due(now);

        assert_eq!(due.len(), 2);
    }

    #[test]
    fn test_count() {
        let mut manager = ReminderManager::new();

        assert_eq!(manager.count(), 0);

        manager.register("+16175551111", "REMINDER: 0 9 * * * | A\nREMINDER: 0 18 * * * | B");
        manager.register("+16175552222", "REMINDER: 0 12 * * * | C");

        assert_eq!(manager.count(), 3);
    }

    #[test]
    fn test_empty_notes() {
        let mut manager = ReminderManager::new();
        manager.register("+16175551234", "");
        assert!(!manager.has_reminders("+16175551234"));
    }

    #[test]
    fn test_reminder_with_special_chars() {
        let notes = "REMINDER: 0 9 * * * | Don't forget: call mom! (urgent)";
        let reminders = ReminderManager::parse_reminders(notes);

        assert_eq!(reminders.len(), 1);
        assert_eq!(reminders[0].prompt, "Don't forget: call mom! (urgent)");
    }

    #[test]
    fn test_cron_schedule_generation() {
        let notes = "REMINDER: 0 9 * * 1 | Monday 9am";
        let reminders = ReminderManager::parse_reminders(notes);

        assert_eq!(reminders.len(), 1);

        // Verify schedule generates correct times
        let schedule = &reminders[0].schedule;
        let start = Utc.with_ymd_and_hms(2024, 1, 15, 0, 0, 0).unwrap(); // Monday
        let next = schedule.after(&start).next().unwrap();

        // Should be 9:00 AM on the same day or next Monday
        assert_eq!(next.hour(), 9);
        assert_eq!(next.minute(), 0);
    }

    // Performance test
    #[test]
    fn test_parse_performance() {
        let notes = (0..100)
            .map(|i| format!("REMINDER: {} * * * * | Reminder {}", i % 60, i))
            .collect::<Vec<_>>()
            .join("\n");

        let start = std::time::Instant::now();
        for _ in 0..100 {
            let _ = ReminderManager::parse_reminders(&notes);
        }
        let elapsed = start.elapsed();

        // Should parse 100 reminders x 100 iterations in under 1 second
        assert!(
            elapsed.as_secs() < 1,
            "Reminder parsing too slow: {:?}",
            elapsed
        );
    }
}
