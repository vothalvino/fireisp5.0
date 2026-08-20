// =============================================================================
// FireISP 5.0 — App Layout (shell + nav)
// =============================================================================

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import { DrDrillBanner } from '@/components/DrDrillBanner';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { UpdateAvailableBanner } from '@/components/UpdateAvailableBanner';
import { useDarkMode } from '@/auth/DarkModeContext';
import { useAccent } from '@/auth/AccentContext';
import { ChangelogPanel } from '@/components/ChangelogPanel';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NavSection } from '@/components/NavSection';
import { CommandPalette } from '@/components/CommandPalette';
import { NotificationBell } from '@/components/NotificationBell';
import {
  SECTIONS,
  WORKSPACES,
  canSeeHub,
  defaultExpandedSection,
  routeForPath,
  sectionForPath,
  visibleRailItems,
  visibleSectionCount,
  type SectionId,
} from '@/nav/routes';

// ---------------------------------------------------------------------------
// Sidebar accordion state — which sections are open, persisted per browser.
// The nav tree itself lives in src/nav/routes.ts (single route registry);
// the old NAV_GROUPS / TECHNICIAN_NAV_GROUPS fork is gone.
// ---------------------------------------------------------------------------
const EXPANDED_KEY = 'fireisp.nav.expanded';
const WORKSPACE_KEY = 'fireisp.nav.workspace';

function loadExpanded(): SectionId[] {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Older builds allowed several sections to accumulate. Keep only the
        // most recently opened one so existing browsers receive the calmer
        // one-section-at-a-time model immediately.
        return parsed.filter((x): x is SectionId => typeof x === 'string').slice(-1);
      }
    }
  } catch {
    // corrupted state — fall through to fully collapsed
  }
  // No valid stored state: the sidebar starts fully collapsed. The persona
  // default is only used to recover from a genuine role switch — see the
  // stranding-fix effect below — never to seed the very first render.
  return [];
}

export function Layout() {
  const { user, logout, switchOrganization } = useAuth();
  const { t } = useTranslation();
  const { effectiveTheme, toggleTheme } = useDarkMode();
  const { accent, toggleAccent } = useAccent();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Admins can switch their active org to ANY organization (not just ones they're
  // a member of), so for them the switcher lists every org. Non-admins only see
  // the orgs they belong to (from /auth/me → user.organizations).
  //
  // Deliberately an EXACT role check, not hasRole(user.role, 'admin') — hasRole
  // has readonly-passes-every-gate semantics meant for PrivateRoute's *page
  // reachability* (readonly should reach every page), not for a *literal
  // privilege* decision like this one. Readonly is not an admin: it is not a
  // member of every org, so isAdmin=true here would enable the all-orgs query,
  // and swapping `orgs` to that result (dropping the `memberships` fallback)
  // for a role with no actual all-org access — mirrors how the backend gates
  // switch-organization, which is now membership OR the install operator.
  //
  // It reads the backend-resolved flag rather than users.role, because that
  // role is the per-TENANT admin persona: every organisation has one, so the
  // old check offered every tenant admin an all-orgs switcher listing ISPs
  // they can neither see nor switch into. GET /organizations is scoped to
  // memberships for them now, and switch-organization refuses them (j67).
  const isAdmin = user?.is_install_operator === true;

  // Accordion state: which sections are open. Persisted per browser; starts
  // fully collapsed (see loadExpanded) unless a stored value says otherwise.
  const location = useLocation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<SectionId[]>(() => loadExpanded());
  const trailSection = sectionForPath(location.pathname);

  // Active trail: the section owning the current route auto-expands. Keyed on
  // the section (not the pathname) so collapsing it while on the route sticks.
  useEffect(() => {
    if (trailSection && trailSection !== 'dashboard') {
      setExpanded(prev => (prev.length === 1 && prev[0] === trailSection ? prev : [trailSection]));
    }
  }, [trailSection]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
    } catch {
      // storage unavailable (private mode/quota) — accordion still works in-memory
    }
  }, [expanded]);

  // Stranding fix: after a role change the previously-open sections may all be
  // invisible to the new role — re-seed the persona default so the nav never
  // opens empty. An empty `expanded` is never "stranded" — it's either the
  // sidebar's intentional fully-collapsed starting state (see loadExpanded)
  // or the user closed everything on purpose — leave it alone either way.
  useEffect(() => {
    if (!user) return;
    setExpanded(prev => {
      if (prev.length === 0) return prev;
      const visibleIds = SECTIONS.filter(
        s => s.kind !== 'link' && visibleRailItems(user, s.id).length > 0,
      ).map(s => s.id);
      if (prev.some(id => visibleIds.includes(id))) return prev;
      const primary = defaultExpandedSection(user.role);
      return primary && visibleIds.includes(primary) ? [primary] : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  function toggleSection(id: SectionId) {
    setExpanded(prev => (prev.includes(id) ? [] : [id]));
  }

  // Command palette (Ctrl/Cmd+K) — jumps to any page this role can see.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Treat the mobile drawer as an intentional layer: move focus into it,
  // close on Escape, and return focus to the opener. CSS visibility keeps its
  // off-canvas links out of the tab order while it is closed.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      sidebarRef.current?.querySelector<HTMLButtonElement>('.nav-search-btn')?.focus();
    });
    function onDrawerKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        window.requestAnimationFrame(() => hamburgerRef.current?.focus());
        return;
      }
      if (e.key !== 'Tab' || !sidebarRef.current) return;
      const controls = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onDrawerKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onDrawerKey);
    };
  }, [sidebarOpen]);

  // Navigation-focus presets: admins/readonly wear many hats. Relevant areas
  // move first, while every authorized section remains present below them.
  const canUseWorkspaces = user?.role === 'admin' || user?.role === 'readonly';
  const [workspace, setWorkspace] = useState<string>(() => {
    try {
      return localStorage.getItem(WORKSPACE_KEY) ?? 'full';
    } catch {
      return 'full';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_KEY, workspace);
    } catch {
      // storage unavailable — preset just won't persist
    }
  }, [workspace]);
  const workspaceSections = canUseWorkspaces
    ? WORKSPACES.find(w => w.id === workspace)?.sections
    : undefined;

  const { data: allOrgs } = useQuery({
    queryKey: ['org-switcher-all'],
    queryFn: async (): Promise<{ id: number; name: string }[]> => {
      const res = await api.GET('/organizations', { params: { query: { limit: 500 } as never } });
      if (res.error) return [];
      return (res.data as unknown as { data?: { id: number; name: string }[] })?.data ?? [];
    },
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  async function handleLogout() {
    await logout();
  }

  function closeSidebar() {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  }

  async function handleOrgChange(e: ChangeEvent<HTMLSelectElement>) {
    const newOrgId = Number(e.target.value);
    if (!user || newOrgId === user.organization_id) return;
    setSwitching(true);
    try {
      await switchOrganization(newOrgId);
      // Every list/detail query is scoped to the old org — refetch them all.
      await qc.invalidateQueries();
      // Whatever page the user was on (e.g. a client detail page) likely makes
      // no sense in the new org — land somewhere that's always valid.
      navigate('/');
    } catch (err) {
      // Restore the select to the current org and surface the error
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : t('layout.switchOrgFailed'));
    } finally {
      setSwitching(false);
    }
  }

  const memberships = user?.organizations ?? [];
  const orgs = isAdmin ? (allOrgs ?? memberships) : memberships;
  const showOrgSwitcher = orgs.length > 1;
  const activeRoute = routeForPath(location.pathname);
  const activeSection = SECTIONS.find(section => section.id === trailSection);
  const activeSectionLabel = activeSection ? t(activeSection.labelKey) : null;
  const pageLabel = activeRoute
    ? t(activeRoute.labelKey)
    : activeSectionLabel
      ? activeSectionLabel
      : t('nav.dashboard');
  const sectionLabel = activeSection && activeSection.id !== 'dashboard' && activeSectionLabel !== pageLabel
    ? activeSectionLabel
    : null;

  const navigationSections = user
    ? SECTIONS.flatMap(section => {
      const items = section.kind === 'link' ? [] : visibleRailItems(user, section.id);
      const hubVisible = canSeeHub(user, section);
      if (section.kind !== 'link' && items.length === 0 && !hubVisible) return [];
      return [{
        section,
        items,
        hubVisible,
        sectionCount: visibleSectionCount(user, section.id),
      }];
    })
    : [];
  const dashboardSection = navigationSections.find(entry => entry.section.id === 'dashboard');
  const areaSections = navigationSections.filter(entry => entry.section.id !== 'dashboard');
  const focusOrder = workspaceSections
    ? [
      ...workspaceSections,
      ...(trailSection && trailSection !== 'dashboard' && !workspaceSections.includes(trailSection)
        ? [trailSection]
        : []),
    ]
    : [];
  const focusedSections = focusOrder.flatMap(sectionId => {
    const entry = areaSections.find(candidate => candidate.section.id === sectionId);
    return entry ? [entry] : [];
  });
  const focusedIds = new Set(focusedSections.map(entry => entry.section.id));
  const remainingSections = workspaceSections
    ? areaSections.filter(entry => !focusedIds.has(entry.section.id))
    : areaSections;

  function renderNavigationSection(entry: (typeof navigationSections)[number]) {
    return (
      <NavSection
        key={entry.section.id}
        section={entry.section}
        items={entry.items}
        sectionCount={entry.sectionCount}
        hubVisible={entry.hubVisible}
        expanded={expanded.includes(entry.section.id)}
        onTrail={trailSection === entry.section.id}
        onToggle={toggleSection}
        onNavigate={closeSidebar}
      />
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t('layout.skipToContent')}</a>
      {/* Hamburger button — visible only on mobile via CSS */}
      <button
        ref={hamburgerRef}
        className="hamburger-btn"
        onClick={() => setSidebarOpen(v => !v)}
        aria-label={t('layout.openNav')}
        aria-expanded={sidebarOpen}
        aria-controls="app-sidebar"
      >
        ☰
      </button>

      {/* Backdrop overlay — shown on mobile when sidebar is open */}
      <div
        className={`nav-overlay${sidebarOpen ? ' overlay-open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        id="app-sidebar"
        className={`app-sidebar${sidebarOpen ? ' sidebar-open' : ''}`}
        aria-label={t('layout.primaryNavigation')}
      >
        <div className="sidebar-brand">
          <div>
            <div className="sidebar-brand-name">{t('layout.brandName')}</div>
            <div className="sidebar-brand-subtitle">{t('layout.sidebarSubtitle')}</div>
          </div>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => {
              closeSidebar();
              window.requestAnimationFrame(() => hamburgerRef.current?.focus());
            }}
            aria-label={t('layout.closeNav')}
          >
            ✕
          </button>
        </div>

        <button className="nav-search-btn" onClick={() => setPaletteOpen(true)} aria-haspopup="dialog">
          <span className="nav-search-label">{t('nav.palette.searchButton')}</span>
          <kbd className="nav-search-kbd">⌘K</kbd>
        </button>

        {canUseWorkspaces && (
          <div className="nav-focus-control">
            <label htmlFor="nav-focus-select">{t('nav.workspaces.label')}</label>
            <select
              id="nav-focus-select"
              className="nav-workspace-select"
              value={workspace}
              onChange={e => setWorkspace(e.target.value)}
            >
              {WORKSPACES.map(w => (
                <option key={w.id} value={w.id}>
                  {t(w.labelKey)}
                </option>
              ))}
            </select>
            <span>{t('nav.workspaces.hint')}</span>
          </div>
        )}

        <nav className="app-nav" aria-label={t('layout.primaryNavigation')}>
          {dashboardSection && renderNavigationSection(dashboardSection)}
          {workspaceSections && focusedSections.length > 0 && (
            <div className="nav-area-label">{t('nav.workspaces.focusedAreas')}</div>
          )}
          {focusedSections.map(renderNavigationSection)}
          {workspaceSections && remainingSections.length > 0 && (
            <div className="nav-area-label nav-area-label-secondary">{t('nav.workspaces.allAreas')}</div>
          )}
          {remainingSections.map(renderNavigationSection)}
        </nav>

        {/* User info + logout */}
        <div className="sidebar-account">
          {user && (
            <>
              <div className="sidebar-user-name">{user.name || user.email}</div>
              {/* Show the user's group name (378); the raw role mirror is the fallback */}
              <div className="sidebar-user-role">{user.group?.name ?? user.role}</div>
              {showOrgSwitcher && (
                <select
                  aria-label={t('layout.orgSwitcherLabel')}
                  value={user.organization_id ?? ''}
                  onChange={handleOrgChange}
                  disabled={switching}
                  className="sidebar-org-select"
                >
                  {orgs.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <LanguageSwitcher variant="sidebar" style={{ width: '100%' }} />
          <div className="sidebar-utility-row">
            <button
              onClick={toggleTheme}
              className="sidebar-utility-btn"
              aria-label={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
              title={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
            >
              {effectiveTheme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button
              onClick={toggleAccent}
              className="sidebar-utility-btn"
              aria-label={accent === 'green' ? t('accent.switchToOrange') : t('accent.switchToGreen')}
              title={accent === 'green' ? t('accent.switchToOrange') : t('accent.switchToGreen')}
            >
              <span className="sidebar-accent-dot" />
            </button>
            <span className="sidebar-changelog"><ChangelogPanel /></span>
          </div>
          <button onClick={handleLogout} className="sidebar-signout">
            {t('common.signOut')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main ref={mainRef} className="app-main" id="main-content" tabIndex={-1}>
        {/* One responsive top bar keeps page context and global actions stable. */}
        <header className="app-topbar">
          <div className="app-topbar-context">
            {sectionLabel && <span className="app-topbar-section">{sectionLabel}</span>}
            <strong className="app-topbar-title">{pageLabel}</strong>
          </div>
          <span className="app-topbar-spacer" />
          <NotificationBell />
          {user?.organization_id != null && orgs.length > 0 && (
            <span className="app-topbar-org">
              {orgs.find(o => o.id === user.organization_id)?.name ?? ''}
            </span>
          )}
        </header>
        <DrDrillBanner />
        <EmailVerificationBanner />
        <UpdateAvailableBanner />
        <Outlet />
      </main>

      {paletteOpen && (
        <CommandPalette
          onClose={() => {
            setPaletteOpen(false);
            // On mobile the drawer would otherwise stay open over the page the
            // palette just navigated to.
            closeSidebar();
          }}
        />
      )}
    </div>
  );
}
