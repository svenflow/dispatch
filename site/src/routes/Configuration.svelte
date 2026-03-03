<h1>Configuration</h1>
<p class="lead">All configuration options for Dispatch.</p>

<hr>

<nav class="toc">
  <h3>On this page</h3>
  <ul>
    <li><a href="#config-file">Config File</a></li>
    <li><a href="#required">Required Settings</a></li>
    <li><a href="#optional">Optional Settings</a></li>
    <li><a href="#example">Full Example</a></li>
    <li><a href="#accessing">Accessing Config Values</a></li>
    <li><a href="#env">Environment Variables</a></li>
  </ul>
</nav>

<hr>

<section id="config-file">
  <h2>Config File</h2>
  <p>Configuration lives in <code>config.local.yaml</code> (gitignored). Copy from the template:</p>
  <pre><code>cp config.example.yaml config.local.yaml</code></pre>
</section>

<section id="required">
  <h2>Required Settings</h2>

  <h3>Owner</h3>
  <pre><code>owner:
  name: "John Smith"
  phone: "+16175551234"
  email: "john@example.com"</code></pre>

  <h3>Assistant</h3>
  <pre><code>assistant:
  name: "Sven"
  email: "assistant@example.com"
  phone: "+19495551234"  # For Signal account</code></pre>
</section>

<section id="optional">
  <h2>Optional Settings</h2>

  <h3>Partner</h3>
  <pre><code>partner:
  name: "Jane Smith"</code></pre>
  <p>Used for the partner tier's warm tone personalization.</p>

  <h3>Signal</h3>
  <pre><code>signal:
  account: "+19495551234"</code></pre>
  <p>The phone number registered with signal-cli.</p>

  <h3>Smart Home</h3>
  <pre><code>hue:
  bridges:
    home:
      ip: "10.10.10.10"
    office:
      ip: "10.10.10.11"

lutron:
  bridge_ip: "10.10.10.12"</code></pre>

  <h3>Chrome Profiles</h3>
  <pre><code>chrome:
  profiles:
    0:
      name: "assistant"
      email: "assistant@example.com"
    1:
      name: "owner"
      email: "john@example.com"</code></pre>
  <p>Profile 0 is the assistant's Chrome profile. Profile 1+ are others.</p>

  <h3>Podcast</h3>
  <pre><code>podcast:
  bucket: "my-podcast-bucket"
  title: "My Audio Articles"
  email: "john@example.com"</code></pre>
  <p>For the podcast skill's GCS hosting.</p>
</section>

<section id="example">
  <h2>Full Example</h2>
  <pre><code># config.local.yaml

owner:
  name: "John Smith"
  phone: "+16175551234"
  email: "john@example.com"

partner:
  name: "Jane Smith"

assistant:
  name: "Sven"
  email: "assistant@example.com"
  phone: "+19495551234"

signal:
  account: "+19495551234"

hue:
  bridges:
    home:
      ip: "10.10.10.10"

lutron:
  bridge_ip: "10.10.10.12"

chrome:
  profiles:
    0:
      name: "sven"
      email: "assistant@example.com"
    1:
      name: "owner"
      email: "john@example.com"</code></pre>
</section>

<section id="accessing">
  <h2>Accessing Config Values</h2>
  <p>Use the <code>identity</code> CLI:</p>
  <pre><code>~/dispatch/bin/identity owner.name      # → John Smith
~/dispatch/bin/identity owner.phone     # → +16175551234
~/dispatch/bin/identity hue.bridges.home.ip  # → 10.10.10.10</code></pre>

  <p>In skills and templates, use the <code>!`identity`</code> dynamic prompt:</p>
  <pre><code>**!`identity owner.name`** is the owner.</code></pre>
  <p>This gets replaced at runtime with the actual value.</p>
</section>

<section id="env">
  <h2>Environment Variables</h2>
  <p>Override settings via environment:</p>
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
        <td>Path to config file</td>
      </tr>
      <tr>
        <td><code>DISPATCH_LOG_LEVEL</code></td>
        <td>Log level (DEBUG, INFO, etc.)</td>
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
</style>
