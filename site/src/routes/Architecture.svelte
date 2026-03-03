<h1>Architecture</h1>
<p class="lead">How Dispatch works under the hood.</p>

<hr>

<nav class="toc">
  <h3>On this page</h3>
  <ul>
    <li><a href="#overview">System Overview</a></li>
    <li><a href="#components">Components</a></li>
    <li><a href="#message-flow">Message Flow</a></li>
    <li><a href="#mid-turn">Mid-Turn Steering</a></li>
    <li><a href="#health">Health Monitoring</a></li>
    <li><a href="#lifecycle">Session Lifecycle</a></li>
    <li><a href="#design">Key Design Decisions</a></li>
  </ul>
</nav>

<hr>

<section id="overview">
  <h2>System Overview</h2>
  <pre class="diagram"><code>┌─────────────────────────────────────────────────────────────┐
│  Messages.app (iMessage)      Signal (via signal-cli)       │
│  Polled every 100ms           JSON-RPC socket               │
└────────────────┬──────────────────────────┬─────────────────┘
                 │                          │
                 └──────────────┬───────────┘
                                ▼
                    ┌───────────────────────┐
                    │    Manager Daemon     │
                    │   (event loop)        │
                    └──────────┬────────────┘
                               ▼
                    ┌───────────────────────┐
                    │   Contact Lookup      │
                    │   + Tier Check        │
                    └──────────┬────────────┘
                               ▼
                    ┌───────────────────────┐
                    │   SDK Backend         │
                    │   (session factory)   │
                    └──────────┬────────────┘
                               ▼
              ┌────────────────────────────────┐
              │   Per-Contact SDK Sessions     │
              │   (Claude Opus, async queues,  │
              │    mid-turn message injection) │
              └────────────────────────────────┘
                               ▼
              ┌────────────────────────────────┐
              │   Tools & Skills               │
              │   Browser, Smart Home, Memory, │
              │   Messaging, Files, etc.       │
              └────────────────────────────────┘</code></pre>
</section>

<section id="components">
  <h2>Components</h2>

  <h3>Manager Daemon</h3>
  <p>The main daemon (<code>assistant/manager.py</code>) that:</p>
  <ul>
    <li>Polls Messages.app (chat.db) every 100ms</li>
    <li>Listens to Signal JSON-RPC socket</li>
    <li>Routes messages to appropriate sessions</li>
    <li>Handles session lifecycle</li>
  </ul>

  <h3>SDK Backend</h3>
  <p>Session factory (<code>assistant/sdk_backend.py</code>) that:</p>
  <ul>
    <li>Creates and manages per-contact sessions</li>
    <li>Configures tool access based on tier</li>
    <li>Handles session resumption</li>
    <li>Manages idle reaping</li>
  </ul>

  <h3>SDK Session</h3>
  <p>Per-contact wrapper (<code>assistant/sdk_session.py</code>) that:</p>
  <ul>
    <li>Wraps Claude Agent SDK</li>
    <li>Manages async message queue</li>
    <li>Handles mid-turn steering</li>
    <li>Tracks health and activity</li>
  </ul>

  <h3>Contact Lookup</h3>
  <p>Tier determination via:</p>
  <ul>
    <li>macOS Contacts.app groups</li>
    <li>SQLite cache for O(1) lookups</li>
    <li>AppleScript fallback for writes</li>
  </ul>
</section>

<section id="message-flow">
  <h2>Message Flow</h2>

  <h3>Inbound Message</h3>
  <ol>
    <li>Message arrives in Messages.app or Signal</li>
    <li>Manager detects new message (poll or socket)</li>
    <li>Contact lookup → get tier, name, phone</li>
    <li>If unknown tier → ignore</li>
    <li>If known tier:
      <ul>
        <li>Get or create SDKSession</li>
        <li>Inject message into session queue</li>
        <li>Claude processes and responds</li>
      </ul>
    </li>
  </ol>

  <h3>Outbound Message</h3>
  <p>Claude explicitly calls send CLIs:</p>
  <pre><code>~/.claude/skills/sms-assistant/scripts/send-sms "+phone" "message"
~/.claude/skills/signal/scripts/send-signal "+phone" "message"</code></pre>
  <div class="callout callout-note">
    <strong>Note:</strong> No auto-send — Claude has full control over when and how to respond.
  </div>
</section>

<section id="mid-turn">
  <h2>Mid-Turn Steering</h2>
  <p>New messages can reach Claude between tool calls:</p>
  <pre class="diagram"><code>User sends message
    ↓
Message added to session queue
    ↓
Claude is mid-turn (running tools)
    ↓
Between tool calls, Claude checks queue
    ↓
If new messages, they're included in context
    ↓
Claude can respond or adjust behavior</code></pre>
  <p>This enables responsive behavior without waiting for long operations to complete.</p>
</section>

<section id="health">
  <h2>Health Monitoring</h2>
  <p>Two-tier health check system:</p>

  <h3>Tier 1: Fast Regex (60s)</h3>
  <ul>
    <li>Checks for stuck patterns in session output</li>
    <li>Low CPU, runs every minute</li>
    <li>Catches obvious failures</li>
  </ul>

  <h3>Tier 2: Deep LLM Analysis (5min)</h3>
  <ul>
    <li>Haiku analyzes session state</li>
    <li>Catches subtle issues</li>
    <li>Higher fidelity, runs less often</li>
  </ul>
</section>

<section id="lifecycle">
  <h2>Session Lifecycle</h2>
  <pre class="diagram"><code>New message → Check registry
                ↓
        Session exists? ──No──→ Create session
                ↓                    ↓
               Yes              Set up cwd
                ↓               Inject skills
                ↓               Start SDK agent
                ↓                    ↓
        Inject message ←─────────────┘
                ↓
        Process & respond
                ↓
        Update last_activity
                ↓
        Idle > 2h? ──Yes──→ Reap session
                ↓
               No
                ↓
        Continue...</code></pre>
</section>

<section id="design">
  <h2>Key Design Decisions</h2>
  <ol>
    <li><strong>No auto-send</strong>: Claude explicitly calls send CLIs</li>
    <li><strong>In-process sessions</strong>: No tmux/subprocess shells</li>
    <li><strong>Mid-turn steering</strong>: Async queues for message injection</li>
    <li><strong>Two-tier health</strong>: Speed vs accuracy tradeoff</li>
    <li><strong>Skills as modules</strong>: Shared, version-controlled, injected via symlink</li>
    <li><strong>Opus only</strong>: All sessions use Claude Opus (never Sonnet/Haiku for contacts)</li>
  </ol>
</section>

<style>
  .lead {
    font-size: 1.25rem;
    color: var(--text-secondary);
  }

  hr {
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 1.5rem 0;
  }

  .toc {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 1rem 1.5rem;
  }

  .toc h3 {
    font-size: 0.875rem;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 0.75rem;
  }

  .toc ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .toc li {
    margin: 0.5rem 0;
  }

  section {
    margin: 2rem 0;
  }

  .diagram {
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .callout {
    padding: 1rem 1.5rem;
    border-radius: 6px;
    margin: 1rem 0;
  }

  .callout-note {
    background: rgba(88, 166, 255, 0.1);
    border: 1px solid var(--link-color);
    border-left: 4px solid var(--link-color);
  }
</style>
