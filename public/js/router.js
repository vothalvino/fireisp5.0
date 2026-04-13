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

    // Handle sub-routes like "clients/123" and compound routes like "alerts/rules"
    const parts = page.split('/');
    let basePage = parts[0];
    let params = parts.slice(1);

    // Check for compound route keys (e.g. "alerts/rules")
    if (!routes[basePage] && parts.length >= 2 && routes[parts.slice(0, 2).join('/')]) {
      basePage = parts.slice(0, 2).join('/');
      params = parts.slice(2);
    }

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
      users: 'Users', 'credit-notes': 'Credit Notes', quotes: 'Quotes',
      sites: 'Sites', jobs: 'Jobs', outages: 'Outages',
      warehouses: 'Warehouses', inventory: 'Inventory', roles: 'Roles',
      organizations: 'Organizations', settings: 'Settings',
      'audit-logs': 'Audit Logs', expenses: 'Expenses',
      'ip-pools': 'IP Pools', 'sla-definitions': 'SLA Definitions',
      'snmp-profiles': 'SNMP Profiles', webhooks: 'Webhooks',
      'scheduled-tasks': 'Scheduled Tasks', 'alerts/rules': 'Alert Rules',
      'coverage-zones': 'Coverage Zones', 'network-links': 'Network Links',
    };
    document.getElementById('page-title').textContent = titles[basePage] || basePage;

    currentPage = basePage;

    // Error boundary: catch unhandled errors in page render functions
    try {
      const result = renderFn(document.getElementById('content-area'), ...params);
      // Handle async render functions
      if (result && typeof result.catch === 'function') {
        result.catch(function (err) {
          showPageError(basePage, err);
        });
      }
    } catch (err) {
      showPageError(basePage, err);
    }
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

  function showPageError(pageName, err) {
    var content = document.getElementById('content-area');
    // Sanitize error message to prevent XSS — show generic message for non-string errors
    var msg = (err && typeof err.message === 'string')
      ? err.message.replace(/[<>&"']/g, function (c) {
        return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&#39;' }[c];
      })
      : 'An unexpected error occurred';
    var safePage = (pageName || 'page').replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&#39;' }[c];
    });
    content.innerHTML =
      '<div class="card" style="text-align:center;padding:2rem">' +
        '<h3 style="color:var(--danger,#e74c3c)">⚠ Something went wrong</h3>' +
        '<p style="color:#666">Failed to load the <strong>' + safePage + '</strong> page.</p>' +
        '<p style="font-size:0.85rem;color:#999">' + msg + '</p>' +
        '<button class="btn btn-primary" onclick="location.reload()">Try Again</button>' +
        ' <button class="btn btn-secondary" onclick="location.hash=\'#/dashboard\'">Go to Dashboard</button>' +
      '</div>';
  }

  return { register, navigate, onHashChange, showLogin, showApp, init, current: () => currentPage };
})();
