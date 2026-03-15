<script>
  export let navigateTo;
</script>

<article class="page">
  <header class="page-header">
    <h1>Message Bus</h1>
    <p class="lead">Kafka-on-SQLite event bus for audit trails and analytics.</p>
  </header>

  <section>
    <h2>Overview</h2>
    <p>
      All system events flow through a SQLite-backed message bus. Fire-and-forget
      writes with an in-memory queue ensure the event loop is never blocked.
      Multiple consumer groups can process events independently with committed offsets.
    </p>
  </section>

  <section>
    <h2>Architecture</h2>
    <ul>
      <li><strong>Producer:</strong> <code>produce_event()</code> enqueues events to an in-memory write queue (~microsecond enqueue time)</li>
      <li><strong>Background thread</strong> batches commits to SQLite (no event loop blocking)</li>
      <li><strong>Consumer groups</strong> with independent committed offsets</li>
      <li><strong>Two tables:</strong> <code>records</code> (business events, 7-day retention) and <code>sdk_events</code> (tool call traces, 3-day retention)</li>
    </ul>
  </section>

  <section>
    <h2>Event Taxonomy</h2>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Events</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Message</td>
          <td><code>msg.received</code>, <code>msg.sent</code>, <code>msg.image</code></td>
        </tr>
        <tr>
          <td>Session</td>
          <td><code>session.created</code>, <code>session.stopped</code>, <code>session.restarted</code>, <code>session.compacted</code></td>
        </tr>
        <tr>
          <td>Health</td>
          <td><code>health.check</code>, <code>health.fatal</code>, <code>health.restart</code></td>
        </tr>
        <tr>
          <td>System</td>
          <td><code>system.startup</code>, <code>system.shutdown</code>, <code>system.error</code></td>
        </tr>
        <tr>
          <td>SDK</td>
          <td><code>sdk.tool_call</code>, <code>sdk.turn_complete</code>, <code>sdk.error</code></td>
        </tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Bus CLI</h2>
    <pre><code># Show event statistics
./bin/bus stats

# Tail recent events (like kafka-console-consumer)
./bin/bus tail
./bin/bus tail --type msg.received

# Export events to JSON
./bin/bus export --since 24h > events.json</code></pre>
  </section>

  <section>
    <h2>SDK Event Tracking</h2>
    <ul>
      <li>Every tool call recorded: tool name, duration, success/failure</li>
      <li>Stored in separate <code>sdk_events</code> table with 3-day retention</li>
      <li>Used by analytics consumers for latency monitoring</li>
    </ul>
  </section>

  <section>
    <h2>Consumer Framework</h2>
    <ul>
      <li>Declarative consumer configs</li>
      <li>Independent offset tracking per consumer group</li>
      <li>Future consumers: alerting, analytics dashboard, anomaly detection</li>
    </ul>
  </section>

  <section>
    <h2>Code Integration</h2>
    <pre><code>from dispatch.bus import produce_event

# Fire-and-forget — returns immediately
produce_event("msg.received", {'{'}"chat_id": "+16175551234",
    "contact": "Alice",
    "tier": "admin",
    "text": "what's the weather?",
{'}'})</code></pre>
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

  section {
    margin-bottom: var(--space-8);
  }
</style>
