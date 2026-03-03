<script>
  let { currentPage, onNavigate } = $props();

  const navItems = [
    { id: 'home', label: 'Home', icon: '🏠' },
    { id: 'getting-started', label: 'Getting Started', icon: '🚀' },
    { id: 'tiers', label: 'Contact Tiers', icon: '👥' },
    { id: 'skills', label: 'Skills System', icon: '⚡' },
    { id: 'cli', label: 'CLI Reference', icon: '💻' },
    { id: 'architecture', label: 'Architecture', icon: '🏗️' },
    { id: 'configuration', label: 'Configuration', icon: '⚙️' },
  ];
</script>

<aside class="sidebar">
  <div class="logo">
    <div class="logo-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    </div>
    <span class="logo-text">Dispatch</span>
  </div>

  <nav class="nav">
    {#each navItems as item}
      <button
        class="nav-item"
        class:active={currentPage === item.id}
        onclick={() => onNavigate(item.id)}
      >
        <span class="nav-icon">{item.icon}</span>
        <span class="nav-label">{item.label}</span>
      </button>
    {/each}
  </nav>

  <div class="sidebar-footer">
    <a href="https://github.com/svenflow/dispatch" target="_blank" rel="noopener" class="github-link">
      <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      <span>GitHub</span>
    </a>
  </div>
</aside>

<style>
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: var(--sidebar-width);
    height: 100vh;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    z-index: 100;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1.25rem 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .logo-icon {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, var(--accent-purple), var(--link-color));
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }

  .logo-icon svg {
    width: 18px;
    height: 18px;
  }

  .logo-text {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .nav {
    flex: 1;
    padding: 1rem 0.5rem;
    overflow-y: auto;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-item.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .nav-icon {
    font-size: 1rem;
    width: 1.25rem;
    text-align: center;
  }

  .nav-label {
    flex: 1;
  }

  .sidebar-footer {
    padding: 1rem;
    border-top: 1px solid var(--border-color);
  }

  .github-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    color: var(--text-secondary);
    border-radius: 6px;
    font-size: 0.875rem;
    transition: all 0.15s ease;
  }

  .github-link:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    text-decoration: none;
  }
</style>
