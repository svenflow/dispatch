<script>
  let { navigateTo } = $props();
</script>

<article class="page">
  <header class="page-header">
    <h1>Setup Guide</h1>
    <p class="lead">Complete setup for a dedicated Dispatch Mac.</p>
  </header>

  <nav class="toc">
    <div class="toc-title">Contents</div>
    <ul>
      <li><a href="#prerequisites">Prerequisites</a></li>
      <li><a href="#mac-setup">Mac Setup</a></li>
      <li><a href="#permissions">Permissions</a></li>
      <li><a href="#installation">Installation</a></li>
      <li><a href="#configuration">Configuration</a></li>
      <li><a href="#contacts">Contacts</a></li>
      <li><a href="#first-run">First Run</a></li>
      <li><a href="#optional">Optional Integrations</a></li>
    </ul>
  </nav>

  <div class="callout">
    <strong>Dedicated Mac recommended.</strong> Dispatch runs 24/7 and needs persistent access to Messages.app.
    A Mac Mini is ideal. Running on your daily-driver Mac will work but may be interrupted.
  </div>

  <section id="prerequisites">
    <h2>Prerequisites</h2>

    <h3>Required</h3>
    <ul>
      <li><strong>macOS</strong> with Messages.app and Contacts.app</li>
      <li><strong>Separate iCloud account</strong> for the assistant (not your personal account)</li>
      <li><strong>Claude API key</strong> from <a href="https://console.anthropic.com" target="_blank" rel="noopener">Anthropic Console</a></li>
      <li><strong>Python 3.12+</strong> via <a href="https://github.com/astral-sh/uv" target="_blank" rel="noopener">uv</a></li>
    </ul>

    <h3>Optional</h3>
    <ul>
      <li><strong>Signal account</strong> via signal-cli for Signal messaging</li>
      <li><strong>Chrome</strong> with extension for browser automation</li>
      <li><strong>Philips Hue / Lutron / Sonos</strong> for smart home control</li>
      <li><strong>Google AI API key</strong> for Gemini image generation</li>
    </ul>
  </section>

  <section id="mac-setup">
    <h2>Mac Setup</h2>

    <h3>1. Create a separate iCloud account</h3>
    <p>
      The assistant should have its own Apple ID, separate from yours.
      This gives it its own iMessage phone number and identity.
    </p>
    <ol>
      <li>Go to <a href="https://appleid.apple.com" target="_blank" rel="noopener">appleid.apple.com</a></li>
      <li>Create a new Apple ID with a dedicated email (e.g., <code>dispatch-assistant@gmail.com</code>)</li>
      <li>Sign in to the Mac with this new Apple ID</li>
      <li>Enable iMessage in Messages.app</li>
    </ol>

    <h3>2. Keep Mac awake</h3>
    <p>System Settings &gt; Energy &gt; Prevent automatic sleeping when display is off</p>
  </section>

  <section id="permissions">
    <h2>macOS Permissions</h2>
    <p>Dispatch needs these permissions to function. Grant them in System Settings &gt; Privacy & Security.</p>

    <div class="permission-list">
      <div class="permission">
        <div class="permission-name">Full Disk Access</div>
        <div class="permission-desc">
          Required for reading Messages.app database (<code>chat.db</code>).
          <strong>Add the uv-managed Python binary:</strong>
        </div>
        <pre><code># Find your Python path:
which python3
# Usually: ~/.local/share/uv/python/cpython-3.XX.X-.../bin/python3

# Add this path to Full Disk Access</code></pre>
      </div>

      <div class="permission">
        <div class="permission-name">Automation</div>
        <div class="permission-desc">
          Required for sending messages via Messages.app and controlling other apps.
          Grant when prompted, or add Terminal/iTerm manually.
        </div>
      </div>

      <div class="permission">
        <div class="permission-name">Accessibility</div>
        <div class="permission-desc">
          Required for <code>cliclick</code> screen automation (optional).
          Only needed if using screen control features.
        </div>
      </div>

      <div class="permission">
        <div class="permission-name">Contacts</div>
        <div class="permission-desc">
          Required for looking up contact tiers and information.
        </div>
      </div>
    </div>
  </section>

  <section id="installation">
    <h2>Installation</h2>

    <h3>1. Install uv (Python package manager)</h3>
    <pre><code>curl -LsSf https://astral.sh/uv/install.sh | sh</code></pre>

    <h3>2. Clone and install</h3>
    <pre><code>git clone https://github.com/svenflow/dispatch.git ~/dispatch
cd ~/dispatch
uv sync</code></pre>

    <h3>3. Set up API key</h3>
    <pre><code># Create secrets file
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.claude/secrets.env

# Optional: Add Gemini key for image generation
echo "GEMINI_API_KEY=..." >> ~/.claude/secrets.env</code></pre>
  </section>

  <section id="configuration">
    <h2>Configuration</h2>

    <h3>1. Create config file</h3>
    <pre><code>cp config.example.yaml config.local.yaml</code></pre>

    <h3>2. Edit config.local.yaml</h3>
    <pre><code>owner:
  name: "Your Name"
  phone: "+15555551234"
  email: "you@example.com"

assistant:
  name: "Dispatch"
  email: "dispatch-assistant@gmail.com"

# Optional sections - remove if not using
signal:
  account: "+15555559999"

hue:
  bridges:
    home:
      ip: "10.0.0.50"</code></pre>

    <h3>3. Using identity values</h3>
    <p>
      Config values can be referenced in CLAUDE.md files using the <code>!`identity key`</code> syntax:
    </p>
    <pre><code># In any CLAUDE.md file:
The owner is !`identity owner.name`
Phone: !`identity owner.phone`

# Test from command line:
./bin/identity owner.name</code></pre>
  </section>

  <section id="contacts">
    <h2>Contact Groups</h2>
    <p>Create these groups in Contacts.app to control access tiers:</p>

    <div class="tier-list">
      <div class="tier">
        <div class="tier-name">Claude Admin</div>
        <div class="tier-desc">Full access, browser automation, all tools</div>
      </div>
      <div class="tier">
        <div class="tier-name">Claude Partner</div>
        <div class="tier-desc">Full access with warm/caring tone</div>
      </div>
      <div class="tier">
        <div class="tier-name">Claude Family</div>
        <div class="tier-desc">Read-only, mutations need admin approval</div>
      </div>
      <div class="tier">
        <div class="tier-name">Claude Favorites</div>
        <div class="tier-desc">Restricted tools, own session</div>
      </div>
      <div class="tier">
        <div class="tier-name">Claude Bots</div>
        <div class="tier-desc">AI agents, loop detection enabled</div>
      </div>
    </div>

    <p class="note">
      Contacts not in any group are ignored (no response).
      Add yourself to <strong>Claude Admin</strong> to get started.
    </p>
  </section>

  <section id="first-run">
    <h2>First Run</h2>

    <h3>1. Start the daemon</h3>
    <pre><code>./bin/claude-assistant start</code></pre>

    <h3>2. Check status</h3>
    <pre><code>./bin/claude-assistant status</code></pre>

    <h3>3. Watch logs</h3>
    <pre><code>./bin/claude-assistant logs</code></pre>

    <h3>4. Send a test message</h3>
    <p>Text the assistant's phone number from your phone. You should see the message in logs and get a response.</p>

    <h3>5. Install watchdog (recommended)</h3>
    <pre><code>./bin/watchdog-install</code></pre>
    <p class="note">Auto-restarts on crash with exponential backoff. Sends SMS alerts on repeated failures.</p>
  </section>

  <section id="optional">
    <h2>Optional Integrations</h2>

    <h3>Signal</h3>
    <p>Adds Signal as a second messaging channel.</p>
    <ol>
      <li>Install <a href="https://github.com/AsamK/signal-cli" target="_blank" rel="noopener">signal-cli</a></li>
      <li>Register or link a phone number</li>
      <li>The daemon auto-starts signal-cli with JSON-RPC socket at <code>/tmp/signal-cli.sock</code></li>
    </ol>

    <h3>Chrome Extension</h3>
    <p>Enables browser automation for web tasks.</p>
    <ol>
      <li>Install the Chrome extension from <code>~/.claude/skills/chrome-control/extension/</code></li>
      <li>Enable "Allow in incognito" if needed</li>
      <li>The native messaging host is set up automatically</li>
    </ol>

    <h3>Smart Home</h3>
    <p>Configure bridge IPs in <code>config.local.yaml</code> for Hue, Lutron, and Sonos control.</p>
  </section>

  <section id="next">
    <h2>Next Steps</h2>
    <ul>
      <li>
        <button class="text-link" onclick={() => navigateTo('cli')}>CLI Reference</button>
        <span class="link-desc">- All commands and options</span>
      </li>
      <li>
        <button class="text-link" onclick={() => navigateTo('tiers')}>Contact Tiers</button>
        <span class="link-desc">- Access control system</span>
      </li>
      <li>
        <button class="text-link" onclick={() => navigateTo('skills')}>Skills</button>
        <span class="link-desc">- Built-in capabilities</span>
      </li>
      <li>
        <button class="text-link" onclick={() => navigateTo('philosophy')}>Philosophy</button>
        <span class="link-desc">- Why a separate entity?</span>
      </li>
    </ul>
  </section>
</article>

<style>
  .page {
    max-width: var(--content-max-width);
  }

  .page-header {
    margin-bottom: var(--space-6);
  }

  .lead {
    font-size: 15px;
    color: var(--text-secondary);
    margin: 0;
  }

  .toc {
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    padding: var(--space-4);
    margin-bottom: var(--space-6);
  }

  .toc-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: var(--space-3);
  }

  .toc ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
  }

  .toc li {
    margin: 0;
  }

  .toc a {
    font-size: 12px;
  }

  .callout {
    background: var(--bg-elevated);
    border-left: 3px solid var(--accent);
    padding: var(--space-4);
    margin-bottom: var(--space-8);
    font-size: 13px;
  }

  section {
    margin-bottom: var(--space-8);
  }

  .permission-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--border-default);
    border: 1px solid var(--border-default);
    margin: var(--space-4) 0;
  }

  .permission {
    padding: var(--space-4);
    background: var(--bg-elevated);
  }

  .permission-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
    margin-bottom: var(--space-2);
  }

  .permission-desc {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .permission pre {
    margin: var(--space-3) 0 0;
  }

  .tier-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--border-default);
    border: 1px solid var(--border-default);
    margin: var(--space-4) 0;
  }

  .tier {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    font-size: 12px;
  }

  .tier-name {
    font-family: var(--font-mono);
    font-weight: 500;
  }

  .tier-desc {
    color: var(--text-tertiary);
  }

  .note {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: var(--space-2);
  }

  .text-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: inherit;
    font-family: inherit;
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .text-link:hover {
    color: var(--accent-hover);
  }

  .link-desc {
    color: var(--text-tertiary);
  }

  @media (max-width: 768px) {
    .tier {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-1);
    }
  }
</style>
