//! Claude Assistant Daemon - Rust implementation
//!
//! CLI and daemon for managing SMS-based Claude sessions via tmux.

use chrono::Utc;
use clap::{Parser, Subcommand};
use claude_assistant_rs::config::Config;
use claude_assistant_rs::contacts::ContactsManager;
use claude_assistant_rs::health::HealthStatus;
use claude_assistant_rs::messages::MessagesReader;
use claude_assistant_rs::registry::SessionRegistry;
use claude_assistant_rs::reminder::ReminderManager;
use claude_assistant_rs::session::SessionManager;
use claude_assistant_rs::Result;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tracing::{debug, error, info, warn};
use tracing_subscriber::EnvFilter;

/// Claude Assistant - SMS daemon manager
#[derive(Parser)]
#[command(name = "claude-assistant-rs")]
#[command(about = "Manage the Claude Assistant daemon (Rust implementation)")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the daemon
    Start,

    /// Stop the daemon
    Stop,

    /// Restart the daemon
    Restart,

    /// Show daemon status
    Status,

    /// Tail the log file
    Logs {
        /// Number of lines to show
        #[arg(short = 'n', long, default_value = "50")]
        lines: u32,

        /// Don't follow the log
        #[arg(long = "no-follow")]
        no_follow: bool,
    },

    /// Attach to a tmux session
    Attach {
        /// Session name (omit to list sessions)
        session: Option<String>,
    },

    /// Open dashboard showing all sessions
    Monitor,

    /// Kill a specific tmux session
    KillSession {
        /// Session name
        session: String,
    },

    /// Kill all tmux sessions
    KillSessions,

    /// Restart a specific session
    RestartSession {
        /// Session name
        session: String,
    },

    /// Restart all sessions
    RestartSessions,

    /// Inject a prompt into a session
    InjectPrompt {
        /// Chat ID (phone number or group UUID)
        chat_id: String,

        /// Prompt text (or use --file)
        #[arg(default_value = "")]
        prompt: String,

        /// Target background session
        #[arg(long)]
        bg: bool,

        /// Wrap in SMS format
        #[arg(long)]
        sms: bool,

        /// Wrap in ADMIN OVERRIDE tags
        #[arg(long)]
        admin: bool,

        /// Read prompt from file
        #[arg(short = 'f', long)]
        file: Option<PathBuf>,

        /// Fail if session doesn't exist
        #[arg(long)]
        no_create: bool,

        /// Skip session health check
        #[arg(long)]
        skip_health: bool,

        /// GUID of message being replied to
        #[arg(long)]
        reply_to: Option<String>,
    },

    /// Install LaunchAgent for auto-start
    Install,

    /// Uninstall LaunchAgent
    Uninstall,

    /// Run the daemon (internal)
    #[command(hide = true)]
    Run,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Initialize logging
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();

    let config = Config::default();

    match cli.command {
        Commands::Start => cmd_start(&config),
        Commands::Stop => cmd_stop(&config),
        Commands::Restart => cmd_restart(&config),
        Commands::Status => cmd_status(&config),
        Commands::Logs { lines, no_follow } => cmd_logs(&config, lines, !no_follow),
        Commands::Attach { session } => cmd_attach(&config, session),
        Commands::Monitor => cmd_monitor(&config),
        Commands::KillSession { session } => cmd_kill_session(&config, &session),
        Commands::KillSessions => cmd_kill_sessions(&config),
        Commands::RestartSession { session } => cmd_restart_session(&config, &session),
        Commands::RestartSessions => cmd_restart_sessions(&config),
        Commands::InjectPrompt {
            chat_id,
            prompt,
            bg,
            sms,
            admin,
            file,
            no_create,
            skip_health,
            reply_to,
        } => cmd_inject_prompt(
            &config,
            &chat_id,
            &prompt,
            bg,
            sms,
            admin,
            file.as_deref(),
            no_create,
            skip_health,
            reply_to.as_deref(),
        ),
        Commands::Install => cmd_install(&config),
        Commands::Uninstall => cmd_uninstall(&config),
        Commands::Run => cmd_run(&config),
    }
}

// ============================================================================
// CLI Commands
// ============================================================================

fn get_pid(config: &Config) -> Option<u32> {
    let pid_file = config.state_dir.join("daemon.pid");
    if !pid_file.exists() {
        return None;
    }

    let content = fs::read_to_string(&pid_file).ok()?;
    let pid: u32 = content.trim().parse().ok()?;

    // Check if process is running
    let status = Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status();

    if status.map(|s| s.success()).unwrap_or(false) {
        Some(pid)
    } else {
        // PID file exists but process is dead
        let _ = fs::remove_file(&pid_file);
        None
    }
}

fn is_running(config: &Config) -> bool {
    get_pid(config).is_some()
}

fn cmd_start(config: &Config) -> Result<()> {
    if is_running(config) {
        println!("Daemon already running (PID {})", get_pid(config).unwrap());
        return Ok(());
    }

    // Ensure directories exist
    fs::create_dir_all(&config.state_dir)?;
    fs::create_dir_all(&config.logs_dir)?;

    let log_file = config.logs_dir.join("manager.log");
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)?;

    // Get current executable path
    let exe = std::env::current_exe()?;

    // Start the daemon
    let child = Command::new(&exe)
        .arg("run")
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log))
        .spawn()?;

    // Write PID file
    let pid_file = config.state_dir.join("daemon.pid");
    fs::write(&pid_file, child.id().to_string())?;

    println!("Daemon started (PID {})", child.id());
    println!("Logs: {}", log_file.display());

    Ok(())
}

fn cmd_stop(config: &Config) -> Result<()> {
    let pid = match get_pid(config) {
        Some(p) => p,
        None => {
            println!("Daemon not running");
            return Ok(());
        }
    };

    println!("Stopping daemon (PID {})...", pid);

    // Send SIGTERM
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();

    // Wait for it to die
    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(500));
        let status = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status();
        if !status.map(|s| s.success()).unwrap_or(false) {
            break;
        }
    }

    // Force kill if still running
    let status = Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status();
    if status.map(|s| s.success()).unwrap_or(false) {
        println!("Force killing...");
        let _ = Command::new("kill")
            .args(["-KILL", &pid.to_string()])
            .status();
    }

    let pid_file = config.state_dir.join("daemon.pid");
    let _ = fs::remove_file(&pid_file);

    println!("Daemon stopped");
    Ok(())
}

fn cmd_restart(config: &Config) -> Result<()> {
    if is_running(config) {
        cmd_stop(config)?;
        std::thread::sleep(Duration::from_secs(1));
    }
    cmd_start(config)
}

fn cmd_status(config: &Config) -> Result<()> {
    if let Some(pid) = get_pid(config) {
        // Get uptime
        let result = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "etime="])
            .output();

        if let Ok(output) = result {
            let uptime = String::from_utf8_lossy(&output.stdout);
            println!("Daemon running (PID {}, uptime {})", pid, uptime.trim());
        } else {
            println!("Daemon running (PID {})", pid);
        }

        // Show tmux sessions
        let session_mgr = SessionManager::new(config);
        match session_mgr.list_sessions() {
            Ok(sessions) if !sessions.is_empty() => {
                println!("\nActive sessions:");
                for session in sessions {
                    println!("  {}", session);
                }
            }
            _ => {}
        }
    } else {
        println!("Daemon not running");
    }

    Ok(())
}

fn cmd_logs(config: &Config, lines: u32, follow: bool) -> Result<()> {
    let log_file = config.logs_dir.join("manager.log");
    if !log_file.exists() {
        println!("Log file not found: {}", log_file.display());
        return Ok(());
    }

    let mut cmd = Command::new("tail");
    if follow {
        cmd.arg("-f");
    }
    cmd.args(["-n", &lines.to_string(), log_file.to_str().unwrap()]);

    let _ = cmd.status();
    Ok(())
}

fn cmd_attach(config: &Config, session: Option<String>) -> Result<()> {
    let session_mgr = SessionManager::new(config);

    match session {
        Some(name) => {
            // Attach to session
            let status = Command::new(&config.tmux)
                .args(["attach", "-t", &format!("={}", name)])
                .status()?;
            std::process::exit(status.code().unwrap_or(1));
        }
        None => {
            // List sessions
            match session_mgr.list_sessions() {
                Ok(sessions) if !sessions.is_empty() => {
                    println!("Available sessions:");
                    for session in sessions {
                        println!("  claude-assistant-rs attach {}", session);
                    }
                }
                _ => println!("No sessions running"),
            }
        }
    }

    Ok(())
}

fn cmd_monitor(config: &Config) -> Result<()> {
    let session_mgr = SessionManager::new(config);
    let sessions = session_mgr.list_sessions()?;

    let sessions: Vec<_> = sessions.into_iter().filter(|s| s != "monitor").collect();

    if sessions.is_empty() {
        println!("No sessions to monitor");
        return Ok(());
    }

    // Kill existing monitor session
    let _ = Command::new(&config.tmux)
        .args(["kill-session", "-t", "monitor"])
        .output();

    // Create monitor script for each session
    let make_script = |session: &str| -> String {
        format!(
            r#"while true; do
clear
{} capture-pane -t {} -p 2>/dev/null | tail -30
sleep 1
done"#,
            config.tmux.display(),
            session
        )
    };

    // Create monitor session with first pane
    let first = &sessions[0];
    Command::new(&config.tmux)
        .args([
            "new-session", "-d", "-s", "monitor",
            "/bin/bash", "-c", &make_script(first),
        ])
        .status()?;

    std::thread::sleep(Duration::from_millis(300));

    // Set pane title for first pane
    Command::new(&config.tmux)
        .args(["select-pane", "-t", "monitor:0.0", "-T", first])
        .status()?;

    // Split panes for remaining sessions
    for (i, session) in sessions[1..].iter().enumerate() {
        let split_flag = if (i + 1) % 2 == 1 { "-v" } else { "-h" };

        Command::new(&config.tmux)
            .args([
                "split-window", "-t", "monitor", split_flag,
                "/bin/bash", "-c", &make_script(session),
            ])
            .status()?;

        // Set pane title
        Command::new(&config.tmux)
            .args(["select-pane", "-t", &format!("monitor:0.{}", i + 1), "-T", session])
            .status()?;

        // Rebalance layout
        Command::new(&config.tmux)
            .args(["select-layout", "-t", "monitor", "tiled"])
            .status()?;

        std::thread::sleep(Duration::from_millis(100));
    }

    // Enable pane titles
    Command::new(&config.tmux)
        .args(["set-option", "-t", "monitor", "pane-border-status", "top"])
        .status()?;
    Command::new(&config.tmux)
        .args(["set-option", "-t", "monitor", "pane-border-format", " #{pane_title} "])
        .status()?;

    // Final layout
    Command::new(&config.tmux)
        .args(["select-layout", "-t", "monitor", "tiled"])
        .status()?;

    println!("Monitor session created with {} panes", sessions.len());
    println!("Attaching... (Ctrl+b d to detach)");

    // Attach
    let status = Command::new(&config.tmux)
        .args(["attach", "-t", "monitor"])
        .status()?;
    std::process::exit(status.code().unwrap_or(0));
}

fn cmd_kill_session(config: &Config, session: &str) -> Result<()> {
    let session_mgr = SessionManager::new(config);

    if !session_mgr.session_exists(session) {
        println!("Session not found: {}", session);
        return Ok(());
    }

    session_mgr.kill_session(session)?;
    println!("Killed session: {}", session);
    println!("Session will be recreated on next incoming message");

    Ok(())
}

fn cmd_kill_sessions(config: &Config) -> Result<()> {
    let session_mgr = SessionManager::new(config);
    let sessions = session_mgr.list_sessions()?;

    if sessions.is_empty() {
        println!("No sessions to kill");
        return Ok(());
    }

    for session in &sessions {
        session_mgr.kill_session(session)?;
        println!("Killed: {}", session);
    }

    println!("\nKilled {} sessions", sessions.len());
    println!("Sessions will be recreated on next incoming messages");

    Ok(())
}

fn cmd_restart_session(config: &Config, session: &str) -> Result<()> {
    let session_mgr = SessionManager::new(config);
    let mut registry = SessionRegistry::new(config);
    registry.load()?;

    // Look up session in registry
    let session_data = registry.get_by_session_name(session);
    let (contact_name, tier, _chat_id) = if let Some(data) = session_data {
        (
            data.contact_name.clone().unwrap_or_else(|| session.replace('-', " ")),
            data.tier.clone().unwrap_or_else(|| "favorite".to_string()),
            data.chat_id.clone(),
        )
    } else {
        // Try to derive from session name
        let contact_name = session
            .split('-')
            .map(|w| {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().chain(c).collect(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");

        println!("Session not in registry, using derived name: {}", contact_name);
        (contact_name, "favorite".to_string(), session.to_string())
    };

    let transcript_dir = config.transcripts_dir.join(session);

    // Kill if exists
    if session_mgr.session_exists(session) {
        session_mgr.kill_session(session)?;
        println!("Killed session: {}", session);
        std::thread::sleep(Duration::from_secs(1));
    }

    // Recreate
    session_mgr.create_session(session, &transcript_dir, &tier)?;
    println!("Created session: {} (tier: {}, contact: {})", session, tier, contact_name);

    Ok(())
}

fn cmd_restart_sessions(config: &Config) -> Result<()> {
    let session_mgr = SessionManager::new(config);
    let mut registry = SessionRegistry::new(config);
    registry.load()?;

    let sessions = session_mgr.list_sessions()?;
    if sessions.is_empty() {
        println!("No sessions to restart");
        return Ok(());
    }

    let mut restarted = 0;
    for session in &sessions {
        // Kill
        session_mgr.kill_session(session)?;
        println!("Killed: {}", session);
        std::thread::sleep(Duration::from_millis(500));

        // Get tier from registry
        let tier = registry
            .get_by_session_name(session)
            .and_then(|d| d.tier.clone())
            .unwrap_or_else(|| "favorite".to_string());

        let transcript_dir = config.transcripts_dir.join(session);
        session_mgr.create_session(session, &transcript_dir, &tier)?;
        println!("Recreated: {} (tier: {})", session, tier);
        restarted += 1;
    }

    println!("\nRestarted {}/{} sessions", restarted, sessions.len());
    Ok(())
}

fn cmd_inject_prompt(
    config: &Config,
    chat_id: &str,
    prompt: &str,
    bg: bool,
    sms: bool,
    admin: bool,
    file: Option<&Path>,
    no_create: bool,
    skip_health: bool,
    reply_to: Option<&str>,
) -> Result<()> {
    // Normalize chat_id
    let chat_id = normalize_chat_id(chat_id);

    // Get prompt from file or args
    let prompt = if let Some(path) = file {
        fs::read_to_string(path)?
    } else {
        prompt.to_string()
    };

    if prompt.is_empty() {
        eprintln!("Error: No prompt provided");
        std::process::exit(1);
    }

    // Load registry
    let mut registry = SessionRegistry::new(config);
    registry.load()?;

    // Look up session info
    let session_data = registry.get(&chat_id).cloned();
    let (session_name, contact_name, tier) = if let Some(data) = session_data {
        (
            data.session_name.clone(),
            data.contact_name.clone().unwrap_or_else(|| data.session_name.replace('-', " ")),
            data.tier.clone().unwrap_or_else(|| "favorite".to_string()),
        )
    } else {
        // Try to look up from contacts
        let mut contacts = ContactsManager::new(config);
        if let Ok(Some(contact)) = contacts.lookup_phone(&chat_id) {
            let session_name = SessionManager::session_name_for_contact(&contact.name);
            (session_name, contact.name, contact.tier)
        } else {
            eprintln!("Error: Contact not found for {}", chat_id);
            std::process::exit(5);
        }
    };

    let session_mgr = SessionManager::new(config);

    // Determine target session
    let target = if bg {
        format!("{}-bg", session_name)
    } else {
        session_name.clone()
    };

    // Check if session exists
    if !session_mgr.session_exists(&target) {
        if no_create {
            eprintln!("Error: Session {} does not exist (--no-create)", target);
            std::process::exit(2);
        }

        // Create session
        println!("Creating session {}...", target);
        let transcript_dir = config.transcripts_dir.join(&session_name);
        session_mgr.create_session(&target, &transcript_dir, &tier)?;
    } else if !skip_health {
        // Check health
        match session_mgr.check_health(&target) {
            HealthStatus::Unhealthy(reason) => {
                println!("Session {} unhealthy ({:?}), restarting...", target, reason);
                session_mgr.kill_session(&target)?;
                std::thread::sleep(Duration::from_secs(1));
                let transcript_dir = config.transcripts_dir.join(&session_name);
                session_mgr.create_session(&target, &transcript_dir, &tier)?;
            }
            HealthStatus::Healthy => {}
        }
    }

    // Wrap prompt
    let mut final_prompt = prompt;
    if sms {
        final_prompt = wrap_sms(&final_prompt, &contact_name, &tier, &chat_id, reply_to);
    }
    if admin {
        final_prompt = wrap_admin(&final_prompt);
    }

    // Inject
    session_mgr.inject_text(&target, &final_prompt)?;

    // Update registry
    if registry.get(&chat_id).is_some() {
        registry.update_last_message(&chat_id)?;
    }

    println!("Injected into {}", target);
    Ok(())
}

fn cmd_install(config: &Config) -> Result<()> {
    let plist_dst = dirs::home_dir()
        .unwrap()
        .join("Library/LaunchAgents/com.jsmith.claude-assistant-rs.plist");

    let exe = std::env::current_exe()?;
    let plist_content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jsmith.claude-assistant-rs</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{}/manager.log</string>
    <key>StandardErrorPath</key>
    <string>{}/manager.log</string>
</dict>
</plist>
"#,
        exe.display(),
        config.logs_dir.display(),
        config.logs_dir.display()
    );

    fs::create_dir_all(plist_dst.parent().unwrap())?;
    fs::write(&plist_dst, plist_content)?;
    println!("Installed: {}", plist_dst.display());

    Command::new("launchctl")
        .args(["load", plist_dst.to_str().unwrap()])
        .status()?;
    println!("LaunchAgent loaded - daemon will start on login");

    Ok(())
}

fn cmd_uninstall(_config: &Config) -> Result<()> {
    let plist_dst = dirs::home_dir()
        .unwrap()
        .join("Library/LaunchAgents/com.jsmith.claude-assistant-rs.plist");

    if !plist_dst.exists() {
        println!("LaunchAgent not installed");
        return Ok(());
    }

    Command::new("launchctl")
        .args(["unload", plist_dst.to_str().unwrap()])
        .output()?;

    fs::remove_file(&plist_dst)?;
    println!("LaunchAgent uninstalled");

    Ok(())
}

// ============================================================================
// Daemon Loop
// ============================================================================

fn cmd_run(config: &Config) -> Result<()> {
    info!("Claude Assistant daemon starting (Rust)");

    // Initialize components
    let session_mgr = SessionManager::new(config);
    let mut registry = SessionRegistry::new(config);
    registry.load()?;
    info!("Loaded {} sessions from registry", registry.len());

    let mut contacts = ContactsManager::new(config);
    contacts.load()?;
    info!("Loaded contacts");

    let messages = MessagesReader::new(config);
    let mut reminders = ReminderManager::new();

    // Load last processed ROWID
    let state_file = config.state_dir.join("last_rowid.txt");
    let mut last_rowid: i64 = if state_file.exists() {
        fs::read_to_string(&state_file)?
            .trim()
            .parse()
            .unwrap_or(0)
    } else {
        // Start from current max
        messages.get_max_rowid()?
    };
    info!("Starting from ROWID {}", last_rowid);

    // Health check interval
    let mut last_health_check = std::time::Instant::now();
    let health_check_interval = Duration::from_secs(300); // 5 minutes

    // Reminder check interval
    let mut last_reminder_check = std::time::Instant::now();
    let reminder_check_interval = Duration::from_secs(60); // 1 minute

    // Main loop
    loop {
        // Poll for new messages
        match messages.poll(last_rowid) {
            Ok(new_messages) => {
                for msg in new_messages {
                    // Skip messages from self
                    if msg.is_from_me {
                        last_rowid = last_rowid.max(msg.rowid);
                        continue;
                    }

                    // Get chat_id
                    let chat_id = &msg.chat_id;

                    // Look up sender
                    let sender_info: Option<(String, String)> = if msg.is_group {
                        // For groups, check if any member is blessed
                        if let Ok(Some(contact)) = contacts.lookup_phone(&msg.sender) {
                            if ContactsManager::is_blessed_tier(&contact.tier) {
                                Some((contact.name.clone(), contact.tier.clone()))
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        // Individual: sender is chat_id
                        if let Ok(Some(contact)) = contacts.lookup_phone(chat_id) {
                            if ContactsManager::is_blessed_tier(&contact.tier) {
                                Some((contact.name.clone(), contact.tier.clone()))
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    };

                    // Skip if not blessed
                    let (contact_name, tier) = match sender_info {
                        Some((name, t)) => (name, t),
                        None => {
                            debug!("Ignoring message from unknown/unblessed: {}", chat_id);
                            last_rowid = last_rowid.max(msg.rowid);
                            continue;
                        }
                    };

                    info!(
                        "New message from {} ({}) in chat {}: {}",
                        contact_name,
                        tier,
                        chat_id,
                        msg.text.chars().take(50).collect::<String>()
                    );

                    // Get or create session
                    let session_name = if msg.is_group {
                        SessionManager::session_name_for_group(chat_id, msg.group_name.as_deref())
                    } else {
                        SessionManager::session_name_for_contact(&contact_name)
                    };

                    // Ensure session exists
                    if !session_mgr.session_exists(&session_name) {
                        info!("Creating session: {}", session_name);
                        let transcript_dir = config.transcripts_dir.join(&session_name);
                        ensure_transcript_dir(&transcript_dir)?;

                        if let Err(e) = session_mgr.create_session(&session_name, &transcript_dir, &tier) {
                            error!("Failed to create session {}: {}", session_name, e);
                            last_rowid = last_rowid.max(msg.rowid);
                            continue;
                        }

                        // Register in registry
                        let _ = registry.register(
                            chat_id,
                            &session_name,
                            transcript_dir.to_str().unwrap_or(""),
                            if msg.is_group { "group" } else { "individual" },
                            Some(contact_name.clone()),
                            msg.group_name.clone(),
                            Some(tier.clone()),
                            None, // participants
                        );
                    }

                    // Wrap and inject message
                    let wrapped = wrap_sms(&msg.text, &contact_name, &tier, chat_id, None);
                    if let Err(e) = session_mgr.inject_text(&session_name, &wrapped) {
                        error!("Failed to inject message into {}: {}", session_name, e);
                    } else {
                        // Update last message time
                        let _ = registry.update_last_message(chat_id);
                    }

                    last_rowid = last_rowid.max(msg.rowid);
                }

                // Save last ROWID
                if let Err(e) = fs::write(&state_file, last_rowid.to_string()) {
                    warn!("Failed to save last ROWID: {}", e);
                }
            }
            Err(e) => {
                error!("Failed to poll messages: {}", e);
            }
        }

        // Health checks
        if last_health_check.elapsed() >= health_check_interval {
            debug!("Running health checks...");

            for (chat_id, data) in registry.all().clone() {
                let session_name = &data.session_name;

                match session_mgr.check_health(session_name) {
                    HealthStatus::Unhealthy(reason) => {
                        warn!("Session {} unhealthy: {:?}", session_name, reason);

                        // Restart
                        let _ = session_mgr.kill_session(session_name);
                        std::thread::sleep(Duration::from_secs(1));

                        let transcript_dir = PathBuf::from(&data.transcript_dir);
                        let tier = data.tier.as_deref().unwrap_or("favorite");

                        if let Err(e) = session_mgr.create_session(session_name, &transcript_dir, tier) {
                            error!("Failed to restart session {}: {}", session_name, e);
                        } else {
                            info!("Restarted unhealthy session: {}", session_name);
                        }
                    }
                    HealthStatus::Healthy => {
                        debug!("Session {} healthy", session_name);
                    }
                }
            }

            last_health_check = std::time::Instant::now();
        }

        // Reminder checks
        if last_reminder_check.elapsed() >= reminder_check_interval {
            let now = Utc::now();
            for (chat_id, prompt) in reminders.check_due(now) {
                info!("Reminder due for {}: {}", chat_id, prompt);

                if let Some(data) = registry.get(&chat_id) {
                    if let Err(e) = session_mgr.inject_text(&data.session_name, &prompt) {
                        error!("Failed to inject reminder into {}: {}", data.session_name, e);
                    }
                }
            }

            last_reminder_check = std::time::Instant::now();
        }

        // Sleep before next poll
        std::thread::sleep(Duration::from_secs(1));
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

fn normalize_chat_id(chat_id: &str) -> String {
    // Check if it looks like a group UUID (20+ hex chars)
    if chat_id.len() >= 20 && chat_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return chat_id.to_lowercase();
    }

    // Phone number - normalize to E.164
    let digits: String = chat_id
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '+')
        .collect();

    if digits.starts_with('+') {
        digits
    } else if digits.len() == 10 {
        format!("+1{}", digits)
    } else if digits.len() == 11 && digits.starts_with('1') {
        format!("+{}", digits)
    } else {
        format!("+{}", digits)
    }
}

fn wrap_sms(
    prompt: &str,
    contact_name: &str,
    tier: &str,
    chat_id: &str,
    reply_to: Option<&str>,
) -> String {
    // TODO: Add reply chain context when reply_to is provided
    let reply_context = if reply_to.is_some() {
        "\n[Reply context not yet implemented in Rust version]"
    } else {
        ""
    };

    format!(
        r#"
---SMS FROM {} ({})---
Chat ID: {}{}
{}
---END SMS---
**Important:** You are in a text message session. Communicate back to the user with ~/code/sms-cli/send-sms "{}" "message"
"#,
        contact_name, tier, chat_id, reply_context, prompt, chat_id
    )
}

fn wrap_admin(prompt: &str) -> String {
    format!(
        r#"
---ADMIN OVERRIDE---
From: Jane Doe (admin)
{}
---END ADMIN OVERRIDE---
"#,
        prompt
    )
}

fn ensure_transcript_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir)?;

    // Symlink .claude for skills
    let claude_symlink = dir.join(".claude");
    if !claude_symlink.exists() {
        if let Some(home) = dirs::home_dir() {
            let _ = symlink(home.join(".claude"), &claude_symlink);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_chat_id_phone() {
        assert_eq!(normalize_chat_id("+16175551234"), "+16175551234");
        assert_eq!(normalize_chat_id("6175551234"), "+16175551234");
        assert_eq!(normalize_chat_id("16175551234"), "+16175551234");
        assert_eq!(normalize_chat_id("617-555-1234"), "+16175551234");
    }

    #[test]
    fn test_normalize_chat_id_group() {
        assert_eq!(
            normalize_chat_id("ABC123DEF456789012345"),
            "abc123def456789012345"
        );
    }

    #[test]
    fn test_wrap_sms() {
        let wrapped = wrap_sms("Hello", "John Doe", "admin", "+16175551234", None);
        assert!(wrapped.contains("John Doe"));
        assert!(wrapped.contains("admin"));
        assert!(wrapped.contains("+16175551234"));
        assert!(wrapped.contains("Hello"));
    }

    #[test]
    fn test_wrap_admin() {
        let wrapped = wrap_admin("Test command");
        assert!(wrapped.contains("ADMIN OVERRIDE"));
        assert!(wrapped.contains("Test command"));
    }
}
