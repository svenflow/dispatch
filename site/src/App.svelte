<script>
  import './app.css'
  import Sidebar from './lib/Sidebar.svelte'
  import Home from './routes/Home.svelte'
  import GettingStarted from './routes/GettingStarted.svelte'
  import Tiers from './routes/Tiers.svelte'
  import Skills from './routes/Skills.svelte'
  import CLI from './routes/CLI.svelte'
  import Architecture from './routes/Architecture.svelte'
  import Configuration from './routes/Configuration.svelte'

  let currentPage = $state('home')

  function navigateTo(page) {
    currentPage = page
    window.scrollTo(0, 0)
  }

  const pages = {
    'home': Home,
    'getting-started': GettingStarted,
    'tiers': Tiers,
    'skills': Skills,
    'cli': CLI,
    'architecture': Architecture,
    'configuration': Configuration,
  }

  let pageComponent = $derived(pages[currentPage])
</script>

<div class="layout">
  <Sidebar {currentPage} onNavigate={navigateTo} />

  <main class="main-content">
    <div class="content-wrapper">
      <svelte:component this={pageComponent} {navigateTo} />
    </div>
  </main>
</div>

<style>
  .layout {
    display: flex;
    min-height: 100vh;
  }

  .main-content {
    flex: 1;
    margin-left: var(--sidebar-width);
    padding: 2rem;
  }

  .content-wrapper {
    max-width: var(--content-max-width);
    margin: 0 auto;
  }

  @media (max-width: 768px) {
    .main-content {
      margin-left: 0;
      padding: 1rem;
    }
  }
</style>
