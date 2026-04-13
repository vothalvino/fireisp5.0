// =============================================================================
// FireISP 5.0 — App Bootstrap
// =============================================================================

/* global document, API, Router */

document.addEventListener('DOMContentLoaded', async () => {
  Router.init();

  // ---- Login form ---------------------------------------------------------
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      await API.login(email, password);
      await bootstrapApp();
    } catch (err) {
      errEl.textContent = err.message || 'Login failed';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });

  // ---- Logout -------------------------------------------------------------
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await API.logout();
    Router.showLogin();
  });

  // ---- Sidebar toggle (mobile) -------------------------------------------
  const sidebar = document.getElementById('sidebar');
  document.getElementById('sidebar-toggle-mobile').addEventListener('click', () => sidebar.classList.toggle('open'));
  document.getElementById('sidebar-toggle').addEventListener('click', () => sidebar.classList.toggle('open'));

  // ---- Bootstrap if already authenticated ---------------------------------
  if (API.token()) {
    try {
      await bootstrapApp();
    } catch (_e) {
      API.clearToken();
      Router.showLogin();
    }
  } else {
    Router.showLogin();
  }
});

async function bootstrapApp() {
  const me = await API.me();

  // Pick the first organization
  if (me.organizations?.length > 0 && !API.orgId()) {
    API.setOrgId(me.organizations[0].organization_id || me.organizations[0].id);
  }

  document.getElementById('current-user-name').textContent =
    `${me.first_name || ''} ${me.last_name || ''}`.trim() || me.email;

  const orgNameEl = document.getElementById('org-name');
  if (me.organizations?.length > 0) {
    orgNameEl.textContent = me.organizations[0].name || `Org ${API.orgId()}`;
  }

  Router.showApp();
  Router.onHashChange();
}
