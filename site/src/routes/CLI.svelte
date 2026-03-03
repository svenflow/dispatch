<h1>CLI Reference</h1>
<p class="lead">Command-line interface for managing Dispatch.</p>

<hr>

<nav class="toc">
  <h3>On this page</h3>
  <ul>
    <li><a href="#daemon">Daemon Management</a></li>
    <li><a href="#session">Session Management</a></li>
    <li><a href="#watchdog">Watchdog</a></li>
    <li><a href="#identity">Identity</a></li>
    <li><a href="#env">Environment Variables</a></li>
  </ul>
</nav>

<hr>

<section id="daemon">
  <h2>Daemon Management</h2>

  <h3>start</h3>
  <p>Start the daemon (if not running).</p>
  <pre><code>./bin/claude-assistant start</code></pre>

  <h3>stop</h3>
  <p>Stop the daemon.</p>
  <pre><code>./bin/claude-assistant stop</code></pre>

  <h3>restart</h3>
  <p>Restart the daemon via launchctl.</p>
  <pre><code>./bin/claude-assistant restart</code></pre>
  <div class="callout callout-important">
    <strong>Important:</strong> Always use <code>restart</code> instead of <code>stop</code> + <code>start</code>.
    The restart command uses <code>launchctl kickstart</code> to ensure a clean environment.
  </div>

  <h3>status</h3>
  <p>Show daemon status and active sessions.</p>
  <pre><code>./bin/claude-assistant status</code></pre>
  <p>Output includes:</p>
  <ul>
    <li>Daemon PID and uptime</li>
    <li>Active session count</li>
    <li>Per-session info (contact, tier, model, last activity)</li>
  </ul>

  <h3>logs</h3>
  <p>Tail the daemon log file.</p>
  <pre><code>./bin/claude-assistant logs</code></pre>
</section>

<section id="session">
  <h2>Session Management</h2>

  <h3>kill-session</h3>
  <p>Kill a specific session.</p>
  <pre><code>./bin/claude-assistant kill-session &lt;session&gt;</code></pre>
  <p>Session can be:</p>
  <ul>
    <li>Session name: <code>imessage/_16175551234</code></li>
    <li>Chat ID: <code>+16175551234</code></li>
    <li>Contact name: <code>"John Smith"</code></li>
  </ul>

  <h3>restart-session</h3>
  <p>Restart a specific session (compacts first).</p>
  <pre><code>./bin/claude-assistant restart-session &lt;session&gt;
./bin/claude-assistant restart-session &lt;session&gt; --no-compact  # Skip compaction
./bin/claude-assistant restart-session &lt;session&gt; --tier family  # Override tier</code></pre>

  <h3>restart-sessions</h3>
  <p>Restart all active sessions.</p>
  <pre><code>./bin/claude-assistant restart-sessions</code></pre>

  <h3>compact-session</h3>
  <p>Generate a context summary without restarting.</p>
  <pre><code>./bin/claude-assistant compact-session &lt;session&gt;</code></pre>

  <h3>inject-prompt</h3>
  <p>Inject a prompt into a session.</p>
  <pre><code>./bin/claude-assistant inject-prompt &lt;session&gt; "prompt"
./bin/claude-assistant inject-prompt &lt;session&gt; --sms "message"     # SMS format
./bin/claude-assistant inject-prompt &lt;session&gt; --admin "command"   # Admin override
./bin/claude-assistant inject-prompt &lt;session&gt; --bg "prompt"       # Background</code></pre>
  <div class="callout callout-note">
    <strong>Note:</strong> Always use <code>inject-prompt</code> instead of injecting directly.
    It handles auto-creation, locking, and format wrapping.
  </div>
</section>

<section id="watchdog">
  <h2>Watchdog</h2>

  <h3>watchdog-install</h3>
  <p>Install the auto-recovery watchdog.</p>
  <pre><code>./bin/watchdog-install</code></pre>
  <p>The watchdog:</p>
  <ul>
    <li>Checks daemon health every 60 seconds</li>
    <li>Auto-restarts on crash with exponential backoff</li>
    <li>Sends SMS alerts on recovery attempts</li>
    <li>Stops after 5 consecutive failures</li>
  </ul>

  <h3>watchdog-uninstall</h3>
  <p>Remove the watchdog.</p>
  <pre><code>./bin/watchdog-uninstall</code></pre>

  <h3>watchdog-status</h3>
  <p>Check watchdog status.</p>
  <pre><code>./bin/watchdog-status</code></pre>
</section>

<section id="identity">
  <h2>Identity</h2>

  <h3>identity</h3>
  <p>Look up configuration values.</p>
  <pre><code>./bin/identity owner.name      # → "John Smith"
./bin/identity owner.phone     # → "+16175551234"
./bin/identity assistant.name  # → "Sven"
./bin/identity partner.name    # → "Jane Smith"</code></pre>
  <p>Supports dot notation for nested values.</p>
</section>

<section id="env">
  <h2>Environment Variables</h2>
  <table>
    <thead>
      <tr>
        <th>Variable</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>DISPATCH_CONFIG</code></td>
        <td>Path to config file (default: <code>config.local.yaml</code>)</td>
      </tr>
      <tr>
        <td><code>DISPATCH_LOG_LEVEL</code></td>
        <td>Log level: DEBUG, INFO, WARNING, ERROR</td>
      </tr>
      <tr>
        <td><code>ANTHROPIC_API_KEY</code></td>
        <td>Claude API key</td>
      </tr>
    </tbody>
  </table>
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

  .callout {
    padding: 1rem 1.5rem;
    border-radius: 6px;
    margin: 1rem 0;
  }

  .callout-important {
    background: rgba(163, 113, 247, 0.1);
    border: 1px solid var(--accent-purple);
    border-left: 4px solid var(--accent-purple);
  }

  .callout-note {
    background: rgba(88, 166, 255, 0.1);
    border: 1px solid var(--link-color);
    border-left: 4px solid var(--link-color);
  }
</style>
