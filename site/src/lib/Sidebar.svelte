<script>
  let { currentPage, onNavigate } = $props();

  const navItems = [
    { id: 'home', label: 'Overview' },
    { id: 'philosophy', label: 'Philosophy' },
    { id: 'getting-started', label: 'Getting Started' },
    { id: 'tiers', label: 'Contact Tiers' },
    { id: 'skills', label: 'Skills' },
    { id: 'cli', label: 'CLI Reference' },
    { id: 'architecture', label: 'Architecture' },
    { id: 'configuration', label: 'Configuration' },
  ];

  let mobileMenuOpen = $state(false);

  function handleNav(id) {
    onNavigate(id);
    mobileMenuOpen = false;
  }
</script>

<!-- Mobile header -->
<header class="mobile-header">
  <button class="mobile-menu-btn" onclick={() => mobileMenuOpen = !mobileMenuOpen} aria-label="Toggle menu">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
      {#if mobileMenuOpen}
        <path d="M5 5l10 10M15 5L5 15" />
      {:else}
        <path d="M3 5h14M3 10h14M3 15h14" />
      {/if}
    </svg>
  </button>
  <span class="mobile-title">
    <svg class="mobile-apple-icon" viewBox="0 0 384 512" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
    </svg>
    Dispatch
  </span>
</header>

<!-- Sidebar -->
<aside class="sidebar" class:mobile-open={mobileMenuOpen}>
  <div class="sidebar-header">
    <span class="logo">
      <svg class="apple-icon" viewBox="0 0 384 512" fill="currentColor">
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
      </svg>
      Dispatch
    </span>
    <span class="version">v1.0</span>
  </div>

  <nav class="nav">
    <div class="nav-section">
      <div class="nav-section-title">Documentation</div>
      {#each navItems as item}
        <button
          class="nav-item"
          class:active={currentPage === item.id}
          onclick={() => handleNav(item.id)}
        >
          {item.label}
          {#if currentPage === item.id}
            <span class="nav-indicator"></span>
          {/if}
        </button>
      {/each}
    </div>
  </nav>

  <div class="sidebar-footer">
    <a href="https://github.com/svenflow/dispatch" target="_blank" rel="noopener" class="footer-link">
      GitHub
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3.5 8.5l5-5M4 3.5h4.5V8" />
      </svg>
    </a>
  </div>
</aside>

<!-- Mobile overlay -->
{#if mobileMenuOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="mobile-overlay" onclick={() => mobileMenuOpen = false} role="presentation"></div>
{/if}

<style>
  /* Mobile header */
  .mobile-header {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--nav-height);
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-default);
    padding: 0 var(--space-4);
    align-items: center;
    gap: var(--space-3);
    z-index: 200;
  }

  .mobile-menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: none;
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    cursor: pointer;
    transition: border-color var(--transition-fast);
  }

  .mobile-menu-btn:hover {
    border-color: var(--border-strong);
  }

  .mobile-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
  }

  .mobile-apple-icon {
    width: 14px;
    height: 14px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .mobile-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 99;
  }

  /* Sidebar */
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: var(--sidebar-width);
    height: 100vh;
    height: 100dvh;
    background: var(--bg-surface);
    border-right: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
    z-index: 100;
  }

  .sidebar-header {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }

  .logo {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .apple-icon {
    width: 14px;
    height: 14px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .version {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  /* Navigation */
  .nav {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4) 0;
    -webkit-overflow-scrolling: touch;
  }

  .nav-section {
    padding: 0 var(--space-3);
  }

  .nav-section-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    padding: var(--space-2) var(--space-3);
    margin-bottom: var(--space-1);
  }

  .nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: color var(--transition-fast);
    text-align: left;
    position: relative;
  }

  .nav-item:hover {
    color: var(--text-primary);
  }

  .nav-item.active {
    color: var(--text-primary);
    font-weight: 500;
  }

  .nav-indicator {
    position: absolute;
    top: 0;
    left: 0;
    width: 2px;
    height: 100%;
    background: var(--accent);
  }

  /* Footer */
  .sidebar-footer {
    padding: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .footer-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: 12px;
    color: var(--text-tertiary);
    transition: color var(--transition-fast);
  }

  .footer-link:hover {
    color: var(--text-primary);
  }

  .footer-link svg {
    opacity: 0.6;
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .mobile-header {
      display: flex;
    }

    .mobile-overlay {
      display: block;
    }

    .sidebar {
      transform: translateX(-100%);
      transition: transform var(--transition-smooth);
      top: var(--nav-height);
      height: calc(100vh - var(--nav-height));
      height: calc(100dvh - var(--nav-height));
    }

    .sidebar.mobile-open {
      transform: translateX(0);
    }
  }
</style>
