//! Health checking for tmux sessions
//!
//! Detects crashes, API errors, and unhealthy session states using regex patterns.

use crate::error::Result;
use once_cell::sync::Lazy;
use regex::{Regex, RegexSet};

/// Result of a health check
#[derive(Debug, Clone, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Unhealthy(UnhealthyReason),
}

/// Reason for unhealthy status
#[derive(Debug, Clone, PartialEq)]
pub enum UnhealthyReason {
    SessionMissing,
    ApiErrorsPersistent,
    FatalError(String),
    ClaudeNotRunning,
}

impl std::fmt::Display for UnhealthyReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UnhealthyReason::SessionMissing => write!(f, "session_missing"),
            UnhealthyReason::ApiErrorsPersistent => write!(f, "api_errors_persistent"),
            UnhealthyReason::FatalError(pattern) => write!(f, "fatal_error:{}", pattern),
            UnhealthyReason::ClaudeNotRunning => write!(f, "claude_not_running"),
        }
    }
}

/// API error patterns that may be transient
static API_ERROR_PATTERNS: Lazy<RegexSet> = Lazy::new(|| {
    RegexSet::new(&[
        r"API Error[:\s]\(?(\d{3})",
        r"overloaded_error",
        r"rate_limit_error",
        r"authentication_error",
        r"api_error",
    ])
    .expect("Invalid API error regex")
});

/// Fatal error patterns that require restart
static FATAL_PATTERNS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    vec![
        (
            Regex::new(r"Traceback \(most recent call last\)").unwrap(),
            "python_traceback",
        ),
        (Regex::new(r"(?i)FATAL").unwrap(), "fatal"),
        (Regex::new(r"panic:").unwrap(), "panic"),
        (
            Regex::new(r"(?:has |session )crashed").unwrap(),
            "crashed",
        ),
        (
            Regex::new(r"Segmentation fault").unwrap(),
            "segfault",
        ),
        (
            Regex::new(r"killed by signal").unwrap(),
            "killed",
        ),
        (
            Regex::new(r"tool use concurrency").unwrap(),
            "tool_concurrency",
        ),
        (
            Regex::new(r"Run /rewind to recover").unwrap(),
            "needs_rewind",
        ),
        (
            Regex::new(r"ENOMEM|out of memory").unwrap(),
            "oom",
        ),
        (
            Regex::new(r"(?i)connection refused").unwrap(),
            "connection_refused",
        ),
    ]
});

/// Shell prompt patterns (session ended, claude not running)
static SHELL_PROMPTS: &[char] = &['$', '%', '>', '#'];

/// Check if session content indicates unhealthy state
pub fn check_session_content(content: &str) -> HealthStatus {
    // Check for API errors (only unhealthy if persistent)
    let api_error_count = API_ERROR_PATTERNS.matches(content).iter().count();
    if api_error_count >= 3 {
        return HealthStatus::Unhealthy(UnhealthyReason::ApiErrorsPersistent);
    }

    // Check for fatal errors
    for (pattern, name) in FATAL_PATTERNS.iter() {
        if pattern.is_match(content) {
            return HealthStatus::Unhealthy(UnhealthyReason::FatalError(name.to_string()));
        }
    }

    // Check if claude is still running (shell prompt without claude activity)
    let content_stripped = content.trim();
    let ends_with_prompt = SHELL_PROMPTS
        .iter()
        .any(|p| content_stripped.ends_with(*p));

    if ends_with_prompt && !content.to_lowercase().contains("claude") {
        return HealthStatus::Unhealthy(UnhealthyReason::ClaudeNotRunning);
    }

    HealthStatus::Healthy
}

/// Quick check if content has any concerning patterns
pub fn has_concerning_patterns(content: &str) -> bool {
    API_ERROR_PATTERNS.is_match(content)
        || FATAL_PATTERNS.iter().any(|(p, _)| p.is_match(content))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_healthy_session() {
        let content = r#"
            Claude is working on your request...
            [claude] Processing message
            > Some output here
        "#;
        assert_eq!(check_session_content(content), HealthStatus::Healthy);
    }

    #[test]
    fn test_single_api_error_healthy() {
        // Single API error should not trigger unhealthy
        let content = "API Error (529 overloaded)\nRetrying...";
        assert_eq!(check_session_content(content), HealthStatus::Healthy);
    }

    #[test]
    fn test_persistent_api_errors_unhealthy() {
        // Need 3+ distinct patterns to match - each pattern counts once regardless of occurrences
        let content = r#"
            API Error (529 overloaded)
            overloaded_error occurred
            rate_limit_error from server
            api_error returned
        "#;
        assert!(matches!(
            check_session_content(content),
            HealthStatus::Unhealthy(UnhealthyReason::ApiErrorsPersistent)
        ));
    }

    #[test]
    fn test_python_traceback_fatal() {
        let content = r#"
            Traceback (most recent call last):
                File "script.py", line 1
            NameError: name 'foo' is not defined
        "#;
        let status = check_session_content(content);
        assert!(matches!(
            status,
            HealthStatus::Unhealthy(UnhealthyReason::FatalError(ref s)) if s == "python_traceback"
        ));
    }

    #[test]
    fn test_panic_fatal() {
        let content = "panic: runtime error: index out of range";
        let status = check_session_content(content);
        assert!(matches!(
            status,
            HealthStatus::Unhealthy(UnhealthyReason::FatalError(ref s)) if s == "panic"
        ));
    }

    #[test]
    fn test_segfault_fatal() {
        let content = "Segmentation fault (core dumped)";
        let status = check_session_content(content);
        assert!(matches!(
            status,
            HealthStatus::Unhealthy(UnhealthyReason::FatalError(ref s)) if s == "segfault"
        ));
    }

    #[test]
    fn test_needs_rewind() {
        let content = "Error occurred. Run /rewind to recover from this state.";
        let status = check_session_content(content);
        assert!(matches!(
            status,
            HealthStatus::Unhealthy(UnhealthyReason::FatalError(ref s)) if s == "needs_rewind"
        ));
    }

    #[test]
    fn test_shell_prompt_without_claude() {
        let content = "jsmith@mac ~ $";
        assert!(matches!(
            check_session_content(content),
            HealthStatus::Unhealthy(UnhealthyReason::ClaudeNotRunning)
        ));
    }

    #[test]
    fn test_shell_prompt_with_claude() {
        let content = "claude: Processing...\njsmith@mac ~ $";
        // Should be healthy because "claude" appears in content
        assert_eq!(check_session_content(content), HealthStatus::Healthy);
    }

    #[test]
    fn test_zsh_prompt() {
        let content = "zsh: command not found: foo\n%";
        assert!(matches!(
            check_session_content(content),
            HealthStatus::Unhealthy(UnhealthyReason::ClaudeNotRunning)
        ));
    }

    #[test]
    fn test_unhealthy_reason_display() {
        assert_eq!(
            UnhealthyReason::SessionMissing.to_string(),
            "session_missing"
        );
        assert_eq!(
            UnhealthyReason::FatalError("panic".to_string()).to_string(),
            "fatal_error:panic"
        );
    }

    #[test]
    fn test_has_concerning_patterns() {
        assert!(has_concerning_patterns("API Error (500)"));
        assert!(has_concerning_patterns("panic: oops"));
        assert!(!has_concerning_patterns("All is well"));
    }

    #[test]
    fn test_tool_concurrency_error() {
        let content = "Error: tool use concurrency limit exceeded";
        let status = check_session_content(content);
        assert!(matches!(
            status,
            HealthStatus::Unhealthy(UnhealthyReason::FatalError(ref s)) if s == "tool_concurrency"
        ));
    }

    #[test]
    fn test_oom_error() {
        let content = "JavaScript heap out of memory";
        let status = check_session_content(content);
        assert!(matches!(
            status,
            HealthStatus::Unhealthy(UnhealthyReason::FatalError(ref s)) if s == "oom"
        ));
    }

    // Performance test
    #[test]
    fn test_health_check_performance() {
        let content = r#"
            Claude is working on your task.
            Running: npm install
            Success!
            Claude: Done.
        "#
        .repeat(100);

        let start = std::time::Instant::now();
        for _ in 0..1000 {
            let _ = check_session_content(&content);
        }
        let elapsed = start.elapsed();
        // Should complete 1000 checks on large content in under 2 seconds
        // (includes lazy_static initialization overhead in debug mode)
        assert!(
            elapsed.as_secs() < 2,
            "Health check too slow: {:?}",
            elapsed
        );
    }
}
