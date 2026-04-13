// =============================================================================
// FireISP 5.0 — Client-side Router (hash-based)
// =============================================================================

/* global window, document */

const Router = (() => {
  const routes = {};
  let currentPage = null;

  function register(name, renderFn) {
    routes[name] = renderFn;
  }

  function navigate(page) {
    if (!page || page === '/') page = 'dashboard';
    page = page.replace(/^\//, '');

    // Handle sub-routes like "clients/123"
    const parts = page.split('/');
    const basePage = parts[0];
    const params = parts.slice(1);

    const renderFn = routes[basePage];
    if (!renderFn) {
      document.getElementById('content-area').innerHTML =
        '<div class="card"><h3>Page not found</h3><p>The page you requested does not exist.</p></div>';
      return;
    }

    // Update nav
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === basePage);
    });

    // Update title
    const titles = {
      dashboard: 'Dashboard', clients: 'Clients', contracts: 'Contracts',
      plans: 'Plans', invoices: 'Invoices', payments: 'Payments',
      tickets: 'Tickets', devices: 'Devices', network: 'Network Health',
      users: 'Users',
    };
    document.getElementById('page-title').textContent = titles[basePage] || basePage;

    currentPage = basePage;
    renderFn(document.getElementById('content-area'), ...params);
  }

  function onHashChange() {
    const hash = window.location.hash.replace('#/', '') || 'dashboard';
    if (!API.token()) {
      showLogin();
      return;
    }
    navigate(hash);
  }

  function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  }

  function init() {
    window.addEventListener('hashchange', onHashChange);
  }

  return { register, navigate, onHashChange, showLogin, showApp, init, current: () => currentPage };
})();
