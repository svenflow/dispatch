<script>
  let { navigateTo } = $props();
</script>

<h1>Getting Started</h1>
<p class="lead">Get Dispatch running on your Mac in minutes.</p>

<hr>

<nav class="toc">
  <h3>On this page</h3>
  <ul>
    <li><a href="#requirements">Requirements</a></li>
    <li><a href="#installation">Installation</a></li>
    <li><a href="#verify">Verify it's working</a></li>
    <li><a href="#next-steps">Next steps</a></li>
  </ul>
</nav>

<hr>

<section id="requirements">
  <h2>Requirements</h2>
  <ul>
    <li><strong>macOS</strong> (uses Messages.app, Contacts.app)</li>
    <li><strong>Python 3.12+</strong> with <a href="https://github.com/astral-sh/uv">uv</a> package manager</li>
    <li><strong>Claude API access</strong> (Anthropic)</li>
    <li><strong>Optional</strong>: <code>signal-cli</code> daemon for Signal messaging</li>
    <li><strong>Optional</strong>: Chrome with Chrome Control extension for browser automation</li>
  </ul>
</section>

<section id="installation">
  <h2>Installation</h2>

  <h3>1. Clone the repository</h3>
  <pre><code>git clone https://github.com/svenflow/dispatch.git ~/dispatch
cd ~/dispatch</code></pre>

  <h3>2. Install dependencies</h3>
  <pre><code>uv sync</code></pre>

  <h3>3. Configure</h3>
  <pre><code># Copy the example config
cp config.example.yaml config.local.yaml

# Edit with your settings
nano config.local.yaml</code></pre>

  <p>Key settings:</p>
  <ul>
    <li><code>assistant.name</code> — Your assistant's name</li>
    <li><code>contacts.owner_phone</code> — Your phone number (gets admin tier)</li>
    <li><code>messaging.enabled_backends</code> — Which backends to enable</li>
  </ul>

  <h3>4. Set up Contacts groups</h3>
  <p>Create these groups in macOS Contacts.app:</p>
  <ul>
    <li><code>Claude Admin</code> — Full access users (your phone)</li>
    <li><code>Claude Partner</code> — Partner with full access + warm tone</li>
    <li><code>Claude Family</code> — Family members (read-only)</li>
    <li><code>Claude Favorites</code> — Friends (restricted tools)</li>
    <li><code>Claude Bots</code> — AI agents (loop detection)</li>
  </ul>
  <p>Add contacts to appropriate groups to assign their tier.</p>

  <h3>5. Start the daemon</h3>
  <pre><code>./bin/claude-assistant start</code></pre>

  <h3>6. Install the watchdog (recommended)</h3>
  <p>The watchdog auto-recovers from crashes:</p>
  <pre><code>./bin/watchdog-install</code></pre>
</section>

<section id="verify">
  <h2>Verify it's working</h2>
  <pre><code># Check status
./bin/claude-assistant status

# Watch logs
./bin/claude-assistant logs</code></pre>
  <p>Send yourself a text message — the daemon should pick it up and Claude will respond!</p>
</section>

<section id="next-steps">
  <h2>Next steps</h2>
  <ul>
    <li><button class="link-btn" onclick={() => navigateTo('tiers')}>Contact Tiers</button> — Learn about access control</li>
    <li><button class="link-btn" onclick={() => navigateTo('skills')}>Skills System</button> — Explore built-in capabilities</li>
    <li><button class="link-btn" onclick={() => navigateTo('cli')}>CLI Reference</button> — Full command documentation</li>
  </ul>
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

  h3 {
    margin-top: 1.5rem;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--link-color);
    cursor: pointer;
    font-size: inherit;
    padding: 0;
  }

  .link-btn:hover {
    text-decoration: underline;
    color: var(--link-hover);
  }
</style>
