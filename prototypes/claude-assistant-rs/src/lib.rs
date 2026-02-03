//! Claude Assistant - Rust SMS daemon
//!
//! This daemon manages Claude Code sessions via tmux, responding to SMS messages
//! from blessed contacts (admin, wife, family, favorite tiers).

pub mod messages;
pub mod contacts;
pub mod session;
pub mod registry;
pub mod health;
pub mod reminder;
pub mod config;
pub mod error;

pub use error::{Error, Result};
