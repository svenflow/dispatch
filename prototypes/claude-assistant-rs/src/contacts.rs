//! Contact management - lookup contacts and their tiers

use crate::config::{Config, BLESSED_TIERS};
use crate::error::{Error, Result};
use std::collections::HashMap;
use std::process::Command;

/// Contact information
#[derive(Debug, Clone, PartialEq)]
pub struct Contact {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub tier: String,
}

/// Contact manager with caching
pub struct ContactsManager {
    config: Config,
    cache: HashMap<String, Contact>,
    loaded: bool,
}

impl ContactsManager {
    pub fn new(config: &Config) -> Self {
        Self {
            config: config.clone(),
            cache: HashMap::new(),
            loaded: false,
        }
    }

    /// Load all contacts into cache
    pub fn load(&mut self) -> Result<usize> {
        let output = Command::new(&self.config.contacts_cli)
            .arg("list")
            .arg("--json")
            .output()
            .map_err(|e| Error::CommandFailed(format!("contacts list: {}", e)))?;

        if !output.status.success() {
            return Err(Error::CommandFailed(format!(
                "contacts list failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse JSON output (array of contacts)
        let contacts: Vec<serde_json::Value> = serde_json::from_str(&stdout)
            .map_err(|e| Error::Parse(format!("contacts JSON: {}", e)))?;

        self.cache.clear();

        for c in contacts {
            let name = c["name"].as_str().unwrap_or("").to_string();
            let phone = c["phone"].as_str().map(|s| normalize_phone(s));
            let email = c["email"].as_str().map(|s| s.to_lowercase());
            let tier = c["tier"].as_str().unwrap_or("unknown").to_string();

            let contact = Contact {
                name: name.clone(),
                phone: phone.clone(),
                email: email.clone(),
                tier,
            };

            // Index by phone
            if let Some(ref p) = phone {
                self.cache.insert(p.clone(), contact.clone());
            }

            // Index by email
            if let Some(ref e) = email {
                self.cache.insert(e.clone(), contact.clone());
            }

            // Index by name (lowercase)
            self.cache.insert(name.to_lowercase(), contact);
        }

        self.loaded = true;
        Ok(self.cache.len())
    }

    /// Ensure cache is loaded
    fn ensure_loaded(&mut self) -> Result<()> {
        if !self.loaded {
            self.load()?;
        }
        Ok(())
    }

    /// Lookup contact by phone number
    pub fn lookup_phone(&mut self, phone: &str) -> Result<Option<Contact>> {
        self.ensure_loaded()?;
        let normalized = normalize_phone(phone);
        Ok(self.cache.get(&normalized).cloned())
    }

    /// Lookup contact by email
    pub fn lookup_email(&mut self, email: &str) -> Result<Option<Contact>> {
        self.ensure_loaded()?;
        Ok(self.cache.get(&email.to_lowercase()).cloned())
    }

    /// Lookup contact by phone OR email (for Messages.app identifiers)
    pub fn lookup_identifier(&mut self, identifier: &str) -> Result<Option<Contact>> {
        // Try phone first
        if let Some(contact) = self.lookup_phone(identifier)? {
            return Ok(Some(contact));
        }
        // Try email if it contains @
        if identifier.contains('@') {
            return self.lookup_email(identifier);
        }
        Ok(None)
    }

    /// Lookup contact by name
    pub fn lookup_name(&mut self, name: &str) -> Result<Option<Contact>> {
        self.ensure_loaded()?;
        Ok(self.cache.get(&name.to_lowercase()).cloned())
    }

    /// Get all blessed contacts (admin, wife, family, favorite)
    pub fn list_blessed(&mut self) -> Result<Vec<Contact>> {
        self.ensure_loaded()?;
        let blessed: Vec<Contact> = self
            .cache
            .values()
            .filter(|c| BLESSED_TIERS.contains(&c.tier.as_str()))
            .cloned()
            .collect();

        // Dedupe by name
        let mut seen = std::collections::HashSet::new();
        let deduped: Vec<Contact> = blessed
            .into_iter()
            .filter(|c| seen.insert(c.name.clone()))
            .collect();

        Ok(deduped)
    }

    /// Force refresh the cache
    pub fn refresh(&mut self) -> Result<usize> {
        self.loaded = false;
        self.load()
    }

    /// Check if a tier is blessed
    pub fn is_blessed_tier(tier: &str) -> bool {
        BLESSED_TIERS.contains(&tier)
    }
}

/// Normalize phone number to E.164 format
pub fn normalize_phone(phone: &str) -> String {
    // Remove all non-digit characters except leading +
    let has_plus = phone.starts_with('+');
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();

    if has_plus {
        format!("+{}", digits)
    } else if digits.len() == 10 {
        // Assume US number
        format!("+1{}", digits)
    } else if digits.len() == 11 && digits.starts_with('1') {
        format!("+{}", digits)
    } else {
        format!("+{}", digits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_phone_e164() {
        assert_eq!(normalize_phone("+16175551234"), "+16175551234");
    }

    #[test]
    fn test_normalize_phone_with_spaces() {
        assert_eq!(normalize_phone("+1 617 555 1234"), "+16175551234");
    }

    #[test]
    fn test_normalize_phone_with_dashes() {
        assert_eq!(normalize_phone("617-555-1234"), "+16175551234");
    }

    #[test]
    fn test_normalize_phone_10_digit() {
        assert_eq!(normalize_phone("6175551234"), "+16175551234");
    }

    #[test]
    fn test_normalize_phone_11_digit() {
        assert_eq!(normalize_phone("16175551234"), "+16175551234");
    }

    #[test]
    fn test_is_blessed_tier() {
        assert!(ContactsManager::is_blessed_tier("admin"));
        assert!(ContactsManager::is_blessed_tier("wife"));
        assert!(ContactsManager::is_blessed_tier("family"));
        assert!(ContactsManager::is_blessed_tier("favorite"));
        assert!(!ContactsManager::is_blessed_tier("unknown"));
        assert!(!ContactsManager::is_blessed_tier(""));
    }

    #[test]
    fn test_contact_equality() {
        let c1 = Contact {
            name: "Test User".to_string(),
            phone: Some("+16175551234".to_string()),
            email: Some("test@example.com".to_string()),
            tier: "admin".to_string(),
        };
        let c2 = c1.clone();
        assert_eq!(c1, c2);
    }

    #[test]
    fn test_blessed_tiers_constant() {
        assert_eq!(BLESSED_TIERS.len(), 4);
        assert!(BLESSED_TIERS.iter().all(|t| !t.is_empty()));
    }
}
