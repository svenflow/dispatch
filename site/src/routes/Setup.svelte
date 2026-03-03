<script>
  let { navigateTo } = $props();
</script>

<article class="page">
  <header class="page-header">
    <h1>Setup Guide</h1>
    <p class="lead">Get Dispatch running on a dedicated Mac.</p>
  </header>

  <nav class="toc">
    <div class="toc-title">Contents</div>
    <ul>
      <li><a href="#human-setup">Part 1: Human Setup</a></li>
      <li><a href="#claude-setup">Part 2: Claude Setup</a></li>
    </ul>
  </nav>

  <div class="callout">
    <strong>Dedicated Mac recommended.</strong> Dispatch runs 24/7 and needs persistent access to Messages.app.
    A Mac Mini is ideal.
  </div>

  <!-- PART 1: HUMAN SETUP -->
  <section id="human-setup">
    <h2>Part 1: Human Setup</h2>
    <p class="section-desc">Do these steps manually. Takes about 30 minutes.</p>

    <h3>1. Dedicated Mac with separate iCloud</h3>
    <p>The assistant needs its own Apple ID for its own iMessage phone number.</p>
    <ol>
      <li>Create a dedicated Gmail (e.g., <code>dispatch-assistant@gmail.com</code>)</li>
      <li>Create an Apple ID at <a href="https://appleid.apple.com" target="_blank" rel="noopener">appleid.apple.com</a> using that email</li>
      <li>Sign in to the Mac with this Apple ID</li>
      <li>Enable iMessage in Messages.app</li>
      <li>Enable Messages in iCloud (Messages &gt; Settings &gt; iMessage &gt; Enable Messages in iCloud)</li>
    </ol>

    <h3>2. Keep Mac awake</h3>
    <p>System Settings &gt; Energy &gt; Prevent automatic sleeping when display is off</p>
    <p class="note">Or install Amphetamine from the App Store for more control.</p>

    <h3>3. Grant macOS permissions</h3>
    <p>Open System Settings &gt; Privacy & Security and grant these to your terminal:</p>

    <div class="permission-list">
      <div class="permission">
        <div class="permission-name">Full Disk Access</div>
        <div class="permission-desc">Required for reading Messages database. Add your terminal AND the Python binary (found after uv install).</div>
      </div>
      <div class="permission">
        <div class="permission-name">Automation</div>
        <div class="permission-desc">Required for sending messages via Messages.app. Grant when prompted.</div>
      </div>
      <div class="permission">
        <div class="permission-name">Contacts</div>
        <div class="permission-desc">Required for looking up contact tiers.</div>
      </div>
    </div>

    <h3>4. Install prerequisites</h3>
    <pre><code># Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Follow post-install to add brew to PATH, then:
brew install git gh node uv

# Claude Code CLI
npm install -g @anthropic-ai/claude-code</code></pre>

    <h3>5. Clone the repo</h3>
    <pre><code>gh auth login
gh repo clone svenflow/dispatch ~/dispatch
cd ~/dispatch
uv sync</code></pre>

    <h3>6. Add Python to Full Disk Access</h3>
    <p>Now that uv has installed Python, add it to FDA:</p>
    <pre><code># Find the Python binary path
ls -la ~/dispatch/.venv/bin/python
# Follow the symlink to the actual binary
# Add that path to Full Disk Access in System Settings</code></pre>

    <h3>7. Authenticate Claude</h3>
    <pre><code>claude auth</code></pre>
    <p class="note">This logs you into Claude Code. No manual API key needed.</p>

    <h3>8. Create contact groups</h3>
    <p>In Contacts.app, create these groups:</p>
    <div class="tier-list">
      <div class="tier">
        <div class="tier-name">Claude Admin</div>
        <div class="tier-desc">Full access (add yourself here)</div>
      </div>
      <div class="tier">
        <div class="tier-name">Claude Partner</div>
        <div class="tier-desc">Full access + warm tone</div>
      </div>
      <div class="tier">
        <div class="tier-name">Claude Family</div>
        <div class="tier-desc">Read-only</div>
      </div>
      <div class="tier">
        <div class="tier-name">Claude Favorites</div>
        <div class="tier-desc">Restricted tools</div>
      </div>
      <div class="tier">
        <div class="tier-name">Claude Bots</div>
        <div class="tier-desc">AI agents</div>
      </div>
    </div>
    <p class="note">Add yourself to Claude Admin to get started.</p>
  </section>

  <!-- PART 2: CLAUDE SETUP -->
  <section id="claude-setup">
    <h2>Part 2: Claude Setup</h2>
    <p class="section-desc">Hand off to Claude to finish the installation.</p>

    <h3>Start Claude</h3>
    <pre><code>cd ~/dispatch
claude</code></pre>

    <h3>Give Claude this prompt:</h3>
    <div class="prompt-box">
      <pre><code>I want to set up Dispatch, the personal assistant system.

Read through the bootstrap guides in ~/dispatch/docs/blog/bootstrap/
starting with 03-identity-setup.md.

For each guide:
1. Read it fully
2. Implement what it describes
3. Verify with the checklist at the end
4. Move to the next guide

Start with identity setup - ask me for my info (name, phone, email)
to create config.local.yaml.</code></pre>
    </div>

    <h3>What happens next</h3>
    <p>Claude will work through the bootstrap guides autonomously:</p>
    <ol>
      <li><strong>Identity setup</strong> - Creates config.local.yaml with your info</li>
      <li><strong>Messaging core</strong> - Sets up the daemon that polls iMessage</li>
      <li><strong>Contact tiers</strong> - Configures access control</li>
      <li><strong>Skills system</strong> - Installs modular capabilities</li>
      <li><strong>LaunchAgent</strong> - Installs the daemon to run at boot via launchd</li>
    </ol>

    <h3>The daemon runs via launchd</h3>
    <p>Once set up, the daemon auto-starts at boot. You don't manually run it.</p>
    <pre><code># Check status
./bin/claude-assistant status

# View logs
./bin/claude-assistant logs

# Restart if needed
./bin/claude-assistant restart</code></pre>

    <h3>Verify it works</h3>
    <p>Text the assistant's phone number from your phone. You should see the message in logs and get a response.</p>
  </section>

  <section id="optional">
    <h2>Optional: Additional Integrations</h2>
    <p>After basic setup, you can add:</p>
    <ul>
      <li><strong>Signal</strong> - Second messaging channel via signal-cli</li>
      <li><strong>Chrome extension</strong> - Browser automation</li>
      <li><strong>Smart home</strong> - Hue, Lutron, Sonos control</li>
      <li><strong>Gemini</strong> - Image generation (add GEMINI_API_KEY to ~/.claude/secrets.env)</li>
    </ul>
    <p>Claude can help set these up when you're ready.</p>
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

  .section-desc {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: var(--space-4);
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
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
  }

  .permission-name {
    font-weight: 600;
    font-size: 12px;
    color: var(--text-primary);
    margin-bottom: var(--space-1);
  }

  .permission-desc {
    font-size: 12px;
    color: var(--text-secondary);
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
    padding: var(--space-2) var(--space-4);
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

  .prompt-box {
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  .prompt-box pre {
    margin: 0;
    white-space: pre-wrap;
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
