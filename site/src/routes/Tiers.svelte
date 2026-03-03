<h1>Contact Tiers</h1>
<p class="lead">Control who gets what level of access to your assistant.</p>

<hr>

<nav class="toc">
  <h3>On this page</h3>
  <ul>
    <li><a href="#overview">Overview</a></li>
    <li><a href="#tier-levels">Tier Levels</a></li>
    <li><a href="#tier-details">Tier Details</a></li>
    <li><a href="#setup">Setting Up Tiers</a></li>
  </ul>
</nav>

<hr>

<section id="overview">
  <h2>Overview</h2>
  <p>
    Dispatch uses a tier system to control what each contact can do.
    Tiers are managed via macOS Contacts.app groups — simply add contacts to the appropriate group.
  </p>
</section>

<section id="tier-levels">
  <h2>Tier Levels</h2>
  <table>
    <thead>
      <tr>
        <th>Tier</th>
        <th>Group Name</th>
        <th>Access Level</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Admin</strong></td>
        <td><code>Claude Admin</code></td>
        <td>Full computer control, browser automation, all tools</td>
      </tr>
      <tr>
        <td><strong>Partner</strong></td>
        <td><code>Claude Partner</code></td>
        <td>Full access with personalized warm tone</td>
      </tr>
      <tr>
        <td><strong>Family</strong></td>
        <td><code>Claude Family</code></td>
        <td>Read-only; mutations need admin approval</td>
      </tr>
      <tr>
        <td><strong>Favorite</strong></td>
        <td><code>Claude Favorites</code></td>
        <td>Own session, restricted tools</td>
      </tr>
      <tr>
        <td><strong>Bots</strong></td>
        <td><code>Claude Bots</code></td>
        <td>Read-only with loop detection</td>
      </tr>
      <tr>
        <td><strong>Unknown</strong></td>
        <td>(none)</td>
        <td>Ignored (no session created)</td>
      </tr>
    </tbody>
  </table>
</section>

<section id="tier-details">
  <h2>Tier Details</h2>

  <h3>Admin</h3>
  <p>The owner tier. Admins have:</p>
  <ul>
    <li>Full computer control</li>
    <li>Browser automation</li>
    <li>All tools enabled</li>
    <li><code>--dangerously-skip-permissions</code> mode</li>
  </ul>

  <h3>Partner</h3>
  <p>Same access as admin, but with warmer, more personal tone. The assistant will:</p>
  <ul>
    <li>Be extra caring and supportive</li>
    <li>Go above and beyond to help</li>
    <li>Add personal touches to interactions</li>
  </ul>

  <h3>Family</h3>
  <p>Read-only access with safety guardrails:</p>
  <ul>
    <li>Can read files and search</li>
    <li>Cannot modify files or run destructive commands</li>
    <li>Mutations require admin approval via SMS prompt</li>
  </ul>

  <h3>Favorite</h3>
  <p>Trusted friends with their own session:</p>
  <ul>
    <li>Web search and image analysis</li>
    <li>Limited bash commands</li>
    <li>No file modifications</li>
    <li>Security-conscious responses</li>
  </ul>

  <h3>Bots</h3>
  <p>Other AI agents with loop detection:</p>
  <ul>
    <li>Same restrictions as favorites</li>
    <li>Automatic conversation loop detection</li>
    <li>Will stop responding if no forward progress</li>
  </ul>

  <h3>Unknown</h3>
  <p>Contacts not in any tier group are completely ignored — no session is created, no response is sent.</p>
</section>

<section id="setup">
  <h2>Setting Up Tiers</h2>

  <h3>Via Contacts.app</h3>
  <ol>
    <li>Open <strong>Contacts.app</strong></li>
    <li>Create groups named exactly:
      <ul>
        <li><code>Claude Admin</code></li>
        <li><code>Claude Partner</code></li>
        <li><code>Claude Family</code></li>
        <li><code>Claude Favorites</code></li>
        <li><code>Claude Bots</code></li>
      </ul>
    </li>
    <li>Drag contacts into appropriate groups</li>
  </ol>

  <h3>Via CLI</h3>
  <pre><code># List contacts by tier
~/.claude/skills/contacts/scripts/contacts list --tier admin

# Set a contact's tier
~/.claude/skills/contacts/scripts/contacts tier "John Smith" family

# Look up a contact
~/.claude/skills/contacts/scripts/contacts lookup +16175551234</code></pre>

  <h3>Tier Rules Files</h3>
  <p>Each tier has a rules file that gets injected into sessions:</p>
  <pre><code>~/.claude/skills/sms-assistant/admin-rules.md
~/.claude/skills/sms-assistant/partner-rules.md
~/.claude/skills/sms-assistant/family-rules.md
~/.claude/skills/sms-assistant/favorites-rules.md
~/.claude/skills/sms-assistant/bots-rules.md
~/.claude/skills/sms-assistant/unknown-rules.md</code></pre>
  <p>Edit these to customize behavior per tier.</p>
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
</style>
