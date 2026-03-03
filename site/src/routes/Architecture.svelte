<script>
  let selectedComponent = $state(null);
  let animatingMessage = $state(false);
  let messageStep = $state(0);

  const contacts = [
    { id: 'admin', name: 'Admin', tier: 'admin', color: '#ea580c' },
    { id: 'partner', name: 'Partner', tier: 'partner', color: '#7c3aed' },
    { id: 'family', name: 'Family', tier: 'family', color: '#0891b2' },
  ];

  function selectComponent(id) {
    selectedComponent = selectedComponent === id ? null : id;
  }

  function simulateMessage() {
    if (animatingMessage) return;
    animatingMessage = true;
    messageStep = 0;

    const steps = [1, 2, 3, 4, 5];
    let i = 0;
    const interval = setInterval(() => {
      messageStep = steps[i];
      i++;
      if (i >= steps.length) {
        clearInterval(interval);
        setTimeout(() => {
          animatingMessage = false;
          messageStep = 0;
        }, 1500);
      }
    }, 600);
  }
</script>

<article class="page">
  <header class="page-header">
    <h1>Architecture</h1>
    <p class="lead">How Dispatch isolates contacts and orchestrates agent sessions.</p>
  </header>

  <!-- Interactive System Diagram -->
  <section class="diagram-section">
    <div class="diagram-header">
      <h2>System Overview</h2>
      <button class="simulate-btn" onclick={simulateMessage} disabled={animatingMessage}>
        {animatingMessage ? 'Simulating...' : 'Simulate Message Flow'}
      </button>
    </div>

    <div class="diagram-container">
      <svg viewBox="0 0 800 500" class="architecture-svg">
        <!-- Background grid -->
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e7e5e4" stroke-width="0.5"/>
          </pattern>

          <!-- Gradient for message flow -->
          <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#ea580c" stop-opacity="0"/>
            <stop offset="50%" stop-color="#ea580c" stop-opacity="1"/>
            <stop offset="100%" stop-color="#ea580c" stop-opacity="0"/>
          </linearGradient>

          <!-- Glow filter -->
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <rect width="800" height="500" fill="url(#grid)"/>

        <!-- Input Sources -->
        <g class="input-sources" transform="translate(50, 60)">
          <text x="60" y="-20" class="section-label">Message Sources</text>

          <!-- iMessage -->
          <g
            class="source-box"
            class:active={messageStep >= 1}
            onclick={() => selectComponent('imessage')}
          >
            <rect x="0" y="0" width="120" height="50" rx="0" class="box"/>
            <text x="60" y="30" class="box-label">iMessage</text>
            {#if messageStep >= 1}
              <circle cx="60" cy="25" r="4" class="pulse-dot"/>
            {/if}
          </g>

          <!-- Signal -->
          <g class="source-box" transform="translate(140, 0)">
            <rect x="0" y="0" width="120" height="50" rx="0" class="box"/>
            <text x="60" y="30" class="box-label">Signal</text>
          </g>
        </g>

        <!-- Flow lines from sources to daemon -->
        <g class="flow-lines">
          <path d="M 110 110 L 110 160 L 400 160 L 400 180" class="flow-line" class:active={messageStep >= 2}/>
          <path d="M 250 110 L 250 160 L 400 160 L 400 180" class="flow-line"/>

          {#if messageStep >= 2}
            <circle r="5" fill="#ea580c" filter="url(#glow)">
              <animateMotion dur="0.5s" fill="freeze" path="M 110 110 L 110 160 L 400 160 L 400 180"/>
            </circle>
          {/if}
        </g>

        <!-- Manager Daemon - Central Hub -->
        <g
          class="daemon-hub"
          transform="translate(300, 180)"
          class:active={messageStep >= 2 && messageStep <= 4}
          onclick={() => selectComponent('daemon')}
        >
          <rect x="0" y="0" width="200" height="80" rx="0" class="box primary"/>
          <text x="100" y="35" class="box-label primary">Manager Daemon</text>
          <text x="100" y="55" class="box-sublabel">Polls 100ms | Routes | Orchestrates</text>

          {#if selectedComponent === 'daemon'}
            <g class="detail-popup" transform="translate(210, 0)">
              <rect x="0" y="0" width="180" height="100" class="popup-bg"/>
              <text x="10" y="20" class="popup-title">manager.py</text>
              <text x="10" y="40" class="popup-item">- Polls Messages.app</text>
              <text x="10" y="55" class="popup-item">- Listens Signal socket</text>
              <text x="10" y="70" class="popup-item">- Contact lookup</text>
              <text x="10" y="85" class="popup-item">- Session routing</text>
            </g>
          {/if}
        </g>

        <!-- Contact Lookup -->
        <g class="lookup-step" transform="translate(520, 190)" class:active={messageStep >= 3}>
          <rect x="0" y="0" width="100" height="60" rx="0" class="box subtle"/>
          <text x="50" y="25" class="box-label small">Contact</text>
          <text x="50" y="42" class="box-label small">Lookup</text>
        </g>

        <!-- Tier routing line -->
        <path d="M 500 220 L 520 220" class="flow-line" class:active={messageStep >= 3}/>

        <!-- Contact Sessions (Isolated Blocks) -->
        <g class="contact-sessions" transform="translate(100, 320)">
          <text x="300" y="-30" class="section-label">Isolated Agent Sessions</text>

          {#each contacts as contact, i}
            <g
              class="contact-block"
              transform="translate({i * 200}, 0)"
              class:active={messageStep >= 4 && i === 0}
              onclick={() => selectComponent(contact.id)}
            >
              <!-- Session container -->
              <rect x="0" y="0" width="180" height="140" rx="0" class="session-box" style="--accent: {contact.color}"/>

              <!-- Header -->
              <rect x="0" y="0" width="180" height="30" class="session-header" style="fill: {contact.color}"/>
              <text x="90" y="20" class="session-title">{contact.name}</text>
              <text x="170" y="20" class="tier-badge">{contact.tier}</text>

              <!-- Transcript folder -->
              <g transform="translate(10, 40)">
                <rect x="0" y="0" width="160" height="25" class="folder-box"/>
                <text x="8" y="17" class="folder-path">~/transcripts/{contact.id}/</text>
              </g>

              <!-- SDK Session -->
              <g transform="translate(10, 75)">
                <rect x="0" y="0" width="160" height="25" class="process-box"/>
                <text x="8" y="17" class="process-label">SDK Session (opus)</text>
              </g>

              <!-- Skills access -->
              <g transform="translate(10, 110)">
                <rect x="0" y="0" width="160" height="20" class="skills-box"/>
                <text x="8" y="14" class="skills-label">.claude/ → ~/.claude/skills/</text>
              </g>

              {#if selectedComponent === contact.id}
                <g class="detail-popup" transform="translate(0, 145)">
                  <rect x="0" y="0" width="180" height="70" class="popup-bg"/>
                  <text x="10" y="18" class="popup-title">Isolation guarantees:</text>
                  <text x="10" y="35" class="popup-item">- Own transcript folder</text>
                  <text x="10" y="50" class="popup-item">- Own SDK process</text>
                  <text x="10" y="65" class="popup-item">- Shared skills (read-only)</text>
                </g>
              {/if}
            </g>
          {/each}
        </g>

        <!-- Flow lines from daemon to sessions -->
        <g class="distribution-lines">
          <path d="M 400 260 L 400 290 L 190 290 L 190 320" class="flow-line" class:active={messageStep >= 4}/>
          <path d="M 400 260 L 400 290 L 390 290 L 390 320" class="flow-line"/>
          <path d="M 400 260 L 400 290 L 590 290 L 590 320" class="flow-line"/>

          {#if messageStep >= 4}
            <circle r="5" fill="#ea580c" filter="url(#glow)">
              <animateMotion dur="0.4s" fill="freeze" path="M 400 260 L 400 290 L 190 290 L 190 320"/>
            </circle>
          {/if}
        </g>

        <!-- Response flow (from session back out) -->
        {#if messageStep >= 5}
          <g class="response-flow">
            <path d="M 190 460 L 190 480 L 50 480 L 50 110" class="flow-line response active"/>
            <circle r="5" fill="#16a34a" filter="url(#glow)">
              <animateMotion dur="0.6s" fill="freeze" path="M 190 460 L 190 480 L 50 480 L 50 110"/>
            </circle>
          </g>
        {/if}

        <!-- Legend -->
        <g class="legend" transform="translate(620, 420)">
          <text x="0" y="0" class="legend-title">Click to explore</text>
          <g transform="translate(0, 15)">
            <rect x="0" y="0" width="12" height="12" fill="#ea580c"/>
            <text x="18" y="10" class="legend-item">Message in</text>
          </g>
          <g transform="translate(0, 32)">
            <rect x="0" y="0" width="12" height="12" fill="#16a34a"/>
            <text x="18" y="10" class="legend-item">Response out</text>
          </g>
        </g>
      </svg>
    </div>
  </section>

  <!-- Key Concepts -->
  <section>
    <h2>Key Isolation Principles</h2>

    <div class="principles-grid">
      <div class="principle">
        <div class="principle-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
          </svg>
        </div>
        <div class="principle-content">
          <h3>Transcript Isolation</h3>
          <p>Each contact gets their own folder: <code>~/transcripts/{backend}/{chat_id}/</code></p>
          <p class="detail">Conversation history, context files, and CLAUDE.md are all per-contact. No cross-contamination.</p>
        </div>
      </div>

      <div class="principle">
        <div class="principle-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <path d="M8 21h8M12 17v4"/>
          </svg>
        </div>
        <div class="principle-content">
          <h3>Session Isolation</h3>
          <p>Each contact gets their own SDK session running in the daemon process.</p>
          <p class="detail">Sessions are resumed across restarts. Context is persisted. No shared state between contacts.</p>
        </div>
      </div>

      <div class="principle">
        <div class="principle-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
          </svg>
        </div>
        <div class="principle-content">
          <h3>Shared Skills</h3>
          <p>Skills are symlinked: <code>.claude → ~/.claude</code></p>
          <p class="detail">All sessions access the same skill definitions (read-only). Updates propagate instantly.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Message Flow Detail -->
  <section>
    <h2>Message Flow</h2>

    <div class="flow-steps">
      <div class="flow-step-item">
        <div class="step-number">1</div>
        <div class="step-content">
          <h3>Message Arrives</h3>
          <p>Manager daemon polls Messages.app (100ms) or receives Signal via JSON-RPC socket.</p>
        </div>
      </div>

      <div class="flow-step-item">
        <div class="step-number">2</div>
        <div class="step-content">
          <h3>Contact Lookup</h3>
          <p>Phone number → Contacts.app SQLite → Name, tier, notes.</p>
        </div>
      </div>

      <div class="flow-step-item">
        <div class="step-number">3</div>
        <div class="step-content">
          <h3>Tier Check</h3>
          <p>Unknown tier = ignored. Known tier = route to session.</p>
        </div>
      </div>

      <div class="flow-step-item">
        <div class="step-number">4</div>
        <div class="step-content">
          <h3>Session Injection</h3>
          <p>Message injected into contact's SDK session. Claude processes with full context.</p>
        </div>
      </div>

      <div class="flow-step-item">
        <div class="step-number">5</div>
        <div class="step-content">
          <h3>Response</h3>
          <p>Claude calls <code>send-sms</code> or <code>send-signal</code> CLI explicitly. No auto-send.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Components -->
  <section>
    <h2>Core Components</h2>

    <div class="components-grid">
      <div class="component-card">
        <div class="component-header">
          <span class="component-name">manager.py</span>
          <span class="component-role">Orchestrator</span>
        </div>
        <ul>
          <li>Polls Messages.app every 100ms</li>
          <li>Listens to Signal JSON-RPC socket</li>
          <li>Routes messages to sessions</li>
          <li>Manages session lifecycle</li>
        </ul>
      </div>

      <div class="component-card">
        <div class="component-header">
          <span class="component-name">sdk_backend.py</span>
          <span class="component-role">Session Factory</span>
        </div>
        <ul>
          <li>Creates per-contact sessions</li>
          <li>Configures tool access by tier</li>
          <li>Handles session resumption</li>
          <li>Manages idle reaping</li>
        </ul>
      </div>

      <div class="component-card">
        <div class="component-header">
          <span class="component-name">sdk_session.py</span>
          <span class="component-role">Session Wrapper</span>
        </div>
        <ul>
          <li>Wraps Claude Agent SDK</li>
          <li>Manages async message queue</li>
          <li>Handles mid-turn steering</li>
          <li>Tracks health and activity</li>
        </ul>
      </div>
    </div>
  </section>
</article>

<style>
  .page {
    max-width: 900px;
  }

  .page-header {
    margin-bottom: var(--space-6);
  }

  .lead {
    font-size: 15px;
    color: var(--text-secondary);
    margin: 0;
  }

  section {
    margin-bottom: var(--space-8);
  }

  /* Diagram Section */
  .diagram-section {
    margin-bottom: var(--space-12);
  }

  .diagram-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-4);
  }

  .diagram-header h2 {
    margin: 0;
    border: none;
    padding: 0;
  }

  .simulate-btn {
    background: var(--text-primary);
    color: var(--bg-surface);
    border: none;
    padding: var(--space-2) var(--space-4);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .simulate-btn:hover:not(:disabled) {
    background: var(--accent);
  }

  .simulate-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .diagram-container {
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    padding: var(--space-4);
    overflow: hidden;
  }

  .architecture-svg {
    width: 100%;
    height: auto;
    display: block;
  }

  /* SVG Styles */
  .section-label {
    font-family: var(--font-mono);
    font-size: 10px;
    fill: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .box {
    fill: var(--bg-surface);
    stroke: var(--border-default);
    stroke-width: 1;
    transition: all 0.2s ease;
  }

  .box.primary {
    fill: var(--text-primary);
    stroke: var(--text-primary);
  }

  .box.subtle {
    fill: var(--bg-inset);
    stroke: var(--border-default);
  }

  .source-box:hover .box,
  .daemon-hub:hover .box,
  .contact-block:hover .session-box {
    stroke: var(--accent);
    stroke-width: 2;
  }

  .source-box.active .box,
  .daemon-hub.active .box,
  .contact-block.active .session-box {
    stroke: var(--accent);
    stroke-width: 2;
  }

  .box-label {
    font-family: var(--font-mono);
    font-size: 12px;
    fill: var(--text-secondary);
    text-anchor: middle;
    dominant-baseline: middle;
  }

  .box-label.primary {
    fill: var(--bg-surface);
    font-weight: 500;
  }

  .box-label.small {
    font-size: 10px;
  }

  .box-sublabel {
    font-family: var(--font-mono);
    font-size: 9px;
    fill: var(--text-muted);
    text-anchor: middle;
  }

  .box-label.primary + .box-sublabel {
    fill: rgba(250, 250, 249, 0.6);
  }

  /* Flow lines */
  .flow-line {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 1;
    stroke-dasharray: 4 2;
    transition: all 0.3s ease;
  }

  .flow-line.active {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: none;
  }

  .flow-line.response {
    stroke: var(--success);
  }

  /* Pulse animation */
  .pulse-dot {
    fill: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; r: 4; }
    50% { opacity: 0.5; r: 6; }
  }

  /* Contact session blocks */
  .session-box {
    fill: var(--bg-surface);
    stroke: var(--border-default);
    stroke-width: 1;
  }

  .session-header {
    fill: var(--text-tertiary);
  }

  .session-title {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    fill: white;
    text-anchor: middle;
  }

  .tier-badge {
    font-family: var(--font-mono);
    font-size: 8px;
    fill: rgba(255, 255, 255, 0.7);
    text-anchor: end;
  }

  .folder-box, .process-box, .skills-box {
    fill: var(--bg-inset);
    stroke: var(--border-default);
    stroke-width: 0.5;
  }

  .folder-path, .process-label, .skills-label {
    font-family: var(--font-mono);
    font-size: 8px;
    fill: var(--text-tertiary);
  }

  /* Popups */
  .detail-popup {
    pointer-events: none;
  }

  .popup-bg {
    fill: var(--bg-elevated);
    stroke: var(--border-default);
    stroke-width: 1;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
  }

  .popup-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    fill: var(--text-primary);
  }

  .popup-item {
    font-family: var(--font-mono);
    font-size: 9px;
    fill: var(--text-secondary);
  }

  /* Legend */
  .legend-title {
    font-family: var(--font-mono);
    font-size: 9px;
    fill: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .legend-item {
    font-family: var(--font-mono);
    font-size: 9px;
    fill: var(--text-secondary);
  }

  /* Principles Grid */
  .principles-grid {
    display: grid;
    gap: var(--space-4);
  }

  .principle {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
  }

  .principle-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-inset);
    color: var(--text-tertiary);
  }

  .principle-icon svg {
    width: 20px;
    height: 20px;
  }

  .principle-content h3 {
    font-size: 13px;
    margin: 0 0 var(--space-2);
  }

  .principle-content p {
    font-size: 12px;
    margin: 0;
    color: var(--text-secondary);
  }

  .principle-content .detail {
    margin-top: var(--space-2);
    color: var(--text-tertiary);
  }

  /* Flow Steps */
  .flow-steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .flow-step-item {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
  }

  .step-number {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--text-primary);
    color: var(--bg-surface);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
  }

  .step-content h3 {
    font-size: 12px;
    margin: 0 0 var(--space-1);
  }

  .step-content p {
    font-size: 12px;
    margin: 0;
    color: var(--text-secondary);
  }

  /* Components Grid */
  .components-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: var(--space-4);
  }

  .component-card {
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
  }

  .component-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
  }

  .component-name {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .component-role {
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .component-card ul {
    margin: 0;
    padding-left: var(--space-4);
  }

  .component-card li {
    font-size: 12px;
    color: var(--text-secondary);
    margin: var(--space-1) 0;
  }

  /* Mobile */
  @media (max-width: 768px) {
    .diagram-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }

    .diagram-container {
      overflow-x: auto;
    }

    .architecture-svg {
      min-width: 700px;
    }
  }
</style>
