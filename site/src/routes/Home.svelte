<script>
  let { navigateTo } = $props();
</script>

<div class="hero">
  <h1>Dispatch</h1>
  <p class="subtitle">
    A personal AI assistant daemon that turns Claude into a full computer-controlling agent with
    SMS/Signal messaging, browser automation, smart home control, and persistent memory.
  </p>
  <div class="buttons">
    <button class="btn btn-primary" onclick={() => navigateTo('getting-started')}>
      Get Started
    </button>
    <a href="https://github.com/svenflow/dispatch" class="btn btn-secondary" target="_blank" rel="noopener">
      View on GitHub
    </a>
  </div>
</div>

<hr>

<section>
  <h2>What is Dispatch?</h2>
  <p>Dispatch runs a daemon that:</p>
  <ul>
    <li><strong>Receives messages</strong> from iMessage and Signal in real-time</li>
    <li><strong>Routes them to Claude SDK sessions</strong> based on contact tier (admin, family, favorites, etc.)</li>
    <li><strong>Gives Claude full computer control</strong>: browser automation, file management, smart home, messaging</li>
    <li><strong>Maintains persistent memory</strong> across conversations with full-text search</li>
    <li><strong>Auto-recovers from crashes</strong> via watchdog daemon with exponential backoff</li>
  </ul>
  <p>Each contact gets their own persistent Claude session with conversation history, memories, and tier-appropriate tool access.</p>
</section>

<section>
  <h2>Quick Start</h2>
  <pre><code># Clone the repo
git clone https://github.com/svenflow/dispatch.git ~/dispatch
cd ~/dispatch

# Install dependencies
uv sync

# Copy and edit config
cp config.example.yaml config.local.yaml

# Start the daemon
./bin/claude-assistant start</code></pre>
</section>

<section>
  <h2>Features at a Glance</h2>
  <table>
    <thead>
      <tr>
        <th>Feature</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Messaging</strong></td>
        <td>iMessage + Signal, real-time, group chat support</td>
      </tr>
      <tr>
        <td><strong>Tiers</strong></td>
        <td>Admin, Partner, Family, Favorite, Bots — each with appropriate access</td>
      </tr>
      <tr>
        <td><strong>Skills</strong></td>
        <td>67+ built-in capabilities (browser, smart home, iOS dev, etc.)</td>
      </tr>
      <tr>
        <td><strong>Memory</strong></td>
        <td>Persistent FTS search across all conversations</td>
      </tr>
      <tr>
        <td><strong>Recovery</strong></td>
        <td>Watchdog daemon with exponential backoff</td>
      </tr>
      <tr>
        <td><strong>Mid-turn steering</strong></td>
        <td>New messages reach Claude between tool calls</td>
      </tr>
    </tbody>
  </table>
</section>

<section>
  <h2>Architecture</h2>
  <pre class="architecture"><code>┌─────────────────────────────────────────────────────────────┐
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
              └────────────────────────────────┘</code></pre>
</section>

<style>
  .hero {
    text-align: center;
    padding: 2rem 0 3rem;
  }

  .hero h1 {
    font-size: 3rem;
    margin-bottom: 1rem;
    border: none;
  }

  .subtitle {
    font-size: 1.25rem;
    color: var(--text-secondary);
    max-width: 700px;
    margin: 0 auto 2rem;
    line-height: 1.7;
  }

  .buttons {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 500;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
  }

  .btn-primary {
    background: linear-gradient(135deg, var(--accent-purple), var(--link-color));
    color: white;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
  }

  .btn-secondary:hover {
    background: var(--bg-hover);
    text-decoration: none;
  }

  hr {
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 2rem 0;
  }

  section {
    margin: 2rem 0;
  }

  .architecture {
    font-size: 0.8rem;
    line-height: 1.4;
  }
</style>
