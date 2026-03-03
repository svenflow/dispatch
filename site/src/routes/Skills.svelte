<h1>Skills System</h1>
<p class="lead">Modular capabilities that give Claude superpowers.</p>

<hr>

<nav class="toc">
  <h3>On this page</h3>
  <ul>
    <li><a href="#overview">Overview</a></li>
    <li><a href="#built-in">Built-in Skills (67+)</a></li>
    <li><a href="#structure">Skill Structure</a></li>
    <li><a href="#creating">Creating a Skill</a></li>
  </ul>
</nav>

<hr>

<section id="overview">
  <h2>Overview</h2>
  <p>
    Skills are reusable capability modules that give Claude specific abilities.
    Each skill is a folder in <code>~/.claude/skills/</code> containing:
  </p>
  <ul>
    <li><code>SKILL.md</code> — Documentation with YAML frontmatter</li>
    <li><code>scripts/</code> — CLI executables (optional)</li>
  </ul>
</section>

<section id="built-in">
  <h2>Built-in Skills (67+)</h2>

  <div class="skill-grid">
    <div class="skill-category">
      <h3>💬 Messaging & Communication</h3>
      <ul>
        <li><code>sms-assistant</code> — Messaging guidelines and tier rules</li>
        <li><code>signal</code> — Signal messaging via signal-cli daemon</li>
        <li><code>contacts</code> — Contact lookup and tier management</li>
      </ul>
    </div>

    <div class="skill-category">
      <h3>🌐 Browser Automation</h3>
      <ul>
        <li><code>chrome-control</code> — Full browser automation (clicks, typing, screenshots)</li>
        <li><code>webfetch</code> — Fetch web pages with headless browser</li>
      </ul>
    </div>

    <div class="skill-category">
      <h3>🏠 Smart Home</h3>
      <ul>
        <li><code>hue</code> — Philips Hue light control</li>
        <li><code>lutron</code> — Lutron Caseta dimmers and shades</li>
        <li><code>sonos</code> — Sonos speaker control and TTS announcements</li>
        <li><code>vivint</code> — Security cameras and RTSP streams</li>
      </ul>
    </div>

    <div class="skill-category">
      <h3>🛠️ Development</h3>
      <ul>
        <li><code>ios-app</code> — iOS development and TestFlight</li>
        <li><code>cad</code> — 3D CAD model generation</li>
        <li><code>blender</code> — 3D rendering and animation</li>
        <li><code>touchdesigner</code> — Generative art and visual programming</li>
      </ul>
    </div>

    <div class="skill-category">
      <h3>🤖 AI & Vision</h3>
      <ul>
        <li><code>gemini</code> — Google Gemini chat and vision</li>
        <li><code>nano-banana</code> — Image generation via Gemini</li>
        <li><code>vision</code> — Segmentation, depth estimation, edge detection</li>
        <li><code>image-to-3d</code> — Generate 3D models from images</li>
        <li><code>image-to-video</code> — Generate videos from images</li>
      </ul>
    </div>

    <div class="skill-category">
      <h3>📋 Productivity</h3>
      <ul>
        <li><code>reminders</code> — macOS Reminders integration</li>
        <li><code>notes-app</code> — Apple Notes access</li>
        <li><code>google-suite</code> — Gmail, Calendar, Drive, Docs, Sheets</li>
        <li><code>memory</code> — Persistent memory with FTS search</li>
      </ul>
    </div>

    <div class="skill-category">
      <h3>🎵 Media</h3>
      <ul>
        <li><code>tts</code> — Text-to-speech (Kokoro, Qwen3-TTS)</li>
        <li><code>transcribe</code> — Audio transcription via whisper.cpp</li>
        <li><code>podcast</code> — Podcast feed management</li>
        <li><code>sheet-music</code> — Sheet music search</li>
      </ul>
    </div>
  </div>

  <p><em>And many more...</em></p>
</section>

<section id="structure">
  <h2>Skill Structure</h2>
  <pre><code>~/.claude/skills/my-skill/
├── SKILL.md           # Required: description, triggers, usage
└── scripts/           # Optional: CLI executables
    ├── main-command   # Main CLI tool
    └── helper         # Additional scripts</code></pre>

  <h3>SKILL.md Format</h3>
  <pre><code>---
name: my-skill
description: What this skill does. Include trigger words.
allowed_tiers:        # Optional: restrict to specific tiers
  - admin
  - partner
---

# My Skill

Usage documentation goes here...</code></pre>
</section>

<section id="creating">
  <h2>Creating a Skill</h2>

  <h3>1. Create the skill directory</h3>
  <pre><code>mkdir -p ~/.claude/skills/my-skill/scripts</code></pre>

  <h3>2. Create SKILL.md</h3>
  <pre><code>cat > ~/.claude/skills/my-skill/SKILL.md &lt;&lt; 'EOF'
---
name: my-skill
description: Does something useful. Trigger: do the thing.
---

# My Skill

## Usage

Run `scripts/do-thing` to do the thing.
EOF</code></pre>

  <h3>3. Create scripts (Python example with uv)</h3>
  <pre><code>#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["httpx"]
# ///

import httpx

def main():
    # Your code here
    pass

if __name__ == "__main__":
    main()</code></pre>

  <h3>4. Make executable</h3>
  <pre><code>chmod +x ~/.claude/skills/my-skill/scripts/do-thing</code></pre>

  <h3>Template Variables</h3>
  <p>Skills can use placeholders that get replaced at runtime:</p>
  <table>
    <thead>
      <tr>
        <th>Variable</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><code>&#123;&#123;CONTACT_NAME&#125;&#125;</code></td>
        <td>Current contact's name</td>
      </tr>
      <tr>
        <td><code>&#123;&#123;TIER&#125;&#125;</code></td>
        <td>Current contact's tier</td>
      </tr>
      <tr>
        <td><code>&#123;&#123;CHAT_ID&#125;&#125;</code></td>
        <td>Current chat identifier</td>
      </tr>
    </tbody>
  </table>

  <h3>Skill Discovery</h3>
  <p>Claude automatically discovers skills via the frontmatter:</p>
  <pre><code>description: Control lights. Trigger words: lights, hue, brightness.</code></pre>
  <p>Include trigger words to help Claude know when to use your skill.</p>
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

  .skill-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin: 1.5rem 0;
  }

  .skill-category {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 1rem 1.5rem;
  }

  .skill-category h3 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
    border: none;
  }

  .skill-category ul {
    margin: 0;
    padding-left: 1.25rem;
  }

  .skill-category li {
    margin: 0.25rem 0;
    font-size: 0.9rem;
  }
</style>
