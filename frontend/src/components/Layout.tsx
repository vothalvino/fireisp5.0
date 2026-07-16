// =============================================================================
// FireISP 5.0 — App Layout (shell + nav)
// =============================================================================

import { useEffect, useState, type ChangeEvent } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/api/client';
import { hasRole } from '@/auth/PrivateRoute';
import { DrDrillBanner } from '@/components/DrDrillBanner';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { useDarkMode } from '@/auth/DarkModeContext';
import { ChangelogPanel } from '@/components/ChangelogPanel';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NavSection } from '@/components/NavSection';
import { CommandPalette } from '@/components/CommandPalette';
import {
  SECTIONS,
  WORKSPACES,
  canSeeHub,
  defaultExpandedSection,
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

function loadExpanded(role: string | undefined): SectionId[] {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is SectionId => typeof x === 'string');
      }
    }
  } catch {
    // corrupted state — fall through to the persona default
  }
  const primary = role ? defaultExpandedSection(role) : null;
  return primary ? [primary] : [];
}

export function Layout() {
  const { user, logout, switchOrganization } = useAuth();
  const { t } = useTranslation();
  const { effectiveTheme, toggleTheme } = useDarkMode();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  // Admins can switch their active org to ANY organization (not just ones they're
  // a member of), so for them the switcher lists every org. Non-admins only see
  // the orgs they belong to (from /auth/me → user.organizations).
  const isAdmin = !!user && hasRole(user.role, 'admin');

  // Accordion state: which sections are open. Persisted per browser; seeded
  // with the persona's primary section on first load.
  const location = useLocation();
  const [expanded, setExpanded] = useState<SectionId[]>(() => loadExpanded(user?.role));
  const trailSection = sectionForPath(location.pathname);

  // Active trail: the section owning the current route auto-expands. Keyed on
  // the section (not the pathname) so collapsing it while on the route sticks.
  useEffect(() => {
    if (trailSection && trailSection !== 'dashboard') {
      setExpanded(prev => (prev.includes(trailSection) ? prev : [...prev, trailSection]));
    }
  }, [trailSection]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
    } catch {
      // storage unavailable (private mode/quota) — accordion still works in-memory
    }
  }, [expanded]);

  // Stranding fix: after a role change the stored sections may all be invisible
  // to the new role — re-seed the persona default so the nav never opens empty.
  useEffect(() => {
    if (!user) return;
    const visibleIds = SECTIONS.filter(
      s => s.kind !== 'link' && visibleRailItems(user, s.id).length > 0,
    ).map(s => s.id);
    setExpanded(prev => {
      if (prev.some(id => visibleIds.includes(id))) return prev;
      const primary = defaultExpandedSection(user.role);
      return primary && visibleIds.includes(primary) ? [...prev, primary] : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  function toggleSection(id: SectionId) {
    setExpanded(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
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

  // Workspace presets: admins/readonly wear many hats — let them prune the
  // rendered sidebar to one job without touching permissions. The palette
  // stays unfiltered as the escape hatch.
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
  }

  async function handleOrgChange(e: ChangeEvent<HTMLSelectElement>) {
    const newOrgId = Number(e.target.value);
    if (!user || newOrgId === user.organization_id) return;
    setSwitching(true);
    try {
      await switchOrganization(newOrgId);
      // Every list/detail query is scoped to the old org — refetch them all.
      await qc.invalidateQueries();
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

  return (
    <div className="app-shell">
      {/* Hamburger button — visible only on mobile via CSS */}
      <button
        className="hamburger-btn"
        onClick={() => setSidebarOpen(v => !v)}
        aria-label={sidebarOpen ? t('layout.closeNav') : t('layout.openNav')}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* Mobile top bar — visible only on mobile via CSS */}
      <div className="mobile-topbar">{t('layout.brandName')}</div>

      {/* Backdrop overlay — shown on mobile when sidebar is open */}
      <div
        className={`nav-overlay${sidebarOpen ? ' overlay-open' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside className={`app-sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div style={styles.logo}>{t('layout.brandName')}</div>

        <button className="nav-search-btn" onClick={() => setPaletteOpen(true)}>
          <span className="nav-search-label">{t('nav.palette.searchButton')}</span>
          <kbd className="nav-search-kbd">⌘K</kbd>
        </button>

        {canUseWorkspaces && (
          <select
            className="nav-workspace-select"
            aria-label={t('nav.workspaces.label')}
            value={workspace}
            onChange={e => setWorkspace(e.target.value)}
          >
            {WORKSPACES.map(w => (
              <option key={w.id} value={w.id}>
                {t(w.labelKey)}
              </option>
            ))}
          </select>
        )}

        <nav style={styles.nav}>
          {user &&
            SECTIONS.map(section => {
              if (workspaceSections && section.id !== 'dashboard' && !workspaceSections.includes(section.id)) {
                return null;
              }
              const items = section.kind === 'link' ? [] : visibleRailItems(user, section.id);
              const hubVisible = canSeeHub(user, section);
              if (section.kind !== 'link' && items.length === 0 && !hubVisible) return null;
              return (
                <NavSection
                  key={section.id}
                  section={section}
                  items={items}
                  sectionCount={visibleSectionCount(user, section.id)}
                  hubVisible={hubVisible}
                  expanded={expanded.includes(section.id)}
                  onTrail={trailSection === section.id}
                  onToggle={toggleSection}
                  onNavigate={closeSidebar}
                />
              );
            })}
        </nav>

        {/* User info + logout */}
        <div style={styles.userArea}>
          {user && (
            <>
              <div style={styles.userName}>{user.name || user.email}</div>
              {/* Show the user's group name (378); the raw role mirror is the fallback */}
              <div style={styles.userRole}>{user.group?.name ?? user.role}</div>
              {showOrgSwitcher && (
                <select
                  aria-label={t('layout.orgSwitcherLabel')}
                  value={user.organization_id ?? ''}
                  onChange={handleOrgChange}
                  disabled={switching}
                  style={styles.orgSelect}
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
          <LanguageSwitcher variant="sidebar" style={styles.langSelect} />
          <button
            onClick={toggleTheme}
            style={styles.themeBtn}
            aria-label={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
            title={effectiveTheme === 'dark' ? t('darkMode.switchToLight') : t('darkMode.switchToDark')}
          >
            {effectiveTheme === 'dark' ? '☀️' : '🌙'}
          </button>
          <ChangelogPanel />
            <button onClick={handleLogout} style={styles.logoutBtn}>
            {t('common.signOut')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main">
        {/* Desktop top bar — contextual brand + org status (hidden on mobile) */}
        <header className="app-topbar">
          <span style={styles.topbarBrand}>{t('layout.brandName')}</span>
          <span className="app-topbar-spacer" />
          {user?.organization_id != null && orgs.length > 0 && (
            <span style={styles.topbarOrg}>
              {orgs.find(o => o.id === user.organization_id)?.name ?? ''}
            </span>
          )}
        </header>
        <DrDrillBanner />
        <EmailVerificationBanner />
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

const styles = {
  logo: {
    padding: '1.25rem 1rem',
    fontWeight: 700,
    fontSize: '1.1rem',
    color: '#fff',
    borderBottom: '1px solid var(--sidebar-border)',
  },
  topbarBrand: {
    fontWeight: 700,
    fontSize: '0.95rem',
    color: 'var(--text-primary)',
    letterSpacing: '0.01em',
  },
  topbarOrg: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: 9999,
    padding: '3px 10px',
  },
  nav: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '0.5rem 0',
    overflowY: 'auto' as const,
  },
  userArea: {
    padding: '0.75rem 1rem',
    borderTop: '1px solid var(--sidebar-border)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  userName: { color: '#fff', fontWeight: 600, fontSize: '0.85rem' },
  userRole: { color: 'var(--sidebar-fg-dim)', fontSize: '0.75rem', textTransform: 'capitalize' as const },
  orgSelect: {
    marginTop: 6,
    background: 'var(--sidebar-hover-bg)',
    color: '#fff',
    border: '1px solid var(--sidebar-border)',
    borderRadius: 4,
    padding: '4px 6px',
    fontSize: '0.8rem',
    // Sidebar is always dark; keep the native dropdown popup dark so the white
    // option text stays legible (light theme / Chrome-Windows).
    colorScheme: 'dark' as const,
  },
  langSelect: {
    marginTop: 6,
    alignSelf: 'flex-start' as const,
  },
  logoutBtn: {
    marginTop: 6,
    background: 'transparent',
    border: '1px solid var(--sidebar-border)',
    color: 'var(--sidebar-fg-muted)',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.8rem',
    alignSelf: 'flex-start' as const,
  },
  themeBtn: {
    background: 'transparent',
    border: '1px solid var(--sidebar-border)',
    color: 'var(--sidebar-fg-muted)',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.9rem',
    alignSelf: 'flex-start' as const,
  },
};
