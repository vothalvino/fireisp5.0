// =============================================================================
// FireISP 5.0 — Sidebar accordion section ("Faro" nav)
// =============================================================================
// One collapsible section of the rail. Three kinds (see nav/routes.ts):
//   • link  — plain NavLink (Dashboard)
//   • group — header toggles expansion
//   • hub   — header navigates to the overview page AND expands; the last row
//             is "View all N →" linking to the same hub page
// Subheadings are non-interactive labels rendered when the `sub` id changes
// between consecutive visible items.
// =============================================================================

import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RouteDef, SectionDef } from '@/nav/routes';
import { SectionIcon } from '@/components/NavIcons';

interface NavSectionProps {
  section: SectionDef;
  /** Visible rail items, registry order (pre-filtered by canSee). */
  items: RouteDef[];
  /** Total reachable pages in the section — the "View all N" count. */
  sectionCount: number;
  /** Whether the hub link ("View all" + header navigation) is available. */
  hubVisible: boolean;
  expanded: boolean;
  /** The current route lives inside this section. */
  onTrail: boolean;
  onToggle: (id: SectionDef['id']) => void;
  /** Close the mobile drawer after navigating to a leaf. */
  onNavigate: () => void;
}

export function NavSection({
  section,
  items,
  sectionCount,
  hubVisible,
  expanded,
  onTrail,
  onToggle,
  onNavigate,
}: NavSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (section.kind === 'link') {
    return (
      <NavLink
        to={section.path ?? '/'}
        end={section.path === '/'}
        onClick={onNavigate}
        className={({ isActive }) => `nav-sec-head nav-sec-link${isActive ? ' on-trail' : ''}`}
      >
        <SectionIcon id={section.id} />
        <span className="nav-sec-label">{t(section.labelKey)}</span>
      </NavLink>
    );
  }

  function handleHeaderClick() {
    if (section.kind === 'hub' && hubVisible && section.hubPath) {
      // Hub headers navigate to the overview and open the section.
      if (!expanded) onToggle(section.id);
      navigate(section.hubPath);
      onNavigate();
      return;
    }
    onToggle(section.id);
  }

  const showViewAll = section.kind === 'hub' && hubVisible && section.hubPath;

  let lastSub: string | undefined;

  return (
    <div className="nav-sec">
      <button
        type="button"
        className={`nav-sec-head${onTrail ? ' on-trail' : ''}`}
        aria-expanded={expanded}
        onClick={handleHeaderClick}
      >
        <SectionIcon id={section.id} />
        <span className="nav-sec-label">{t(section.labelKey)}</span>
        <svg className="nav-chev" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="nav-sec-body">
          {items.map(item => {
            const subhead =
              item.sub && item.sub !== lastSub ? (
                <div className="nav-subhead">{t(`nav.subsections.${item.sub}`)}</div>
              ) : null;
            lastSub = item.sub ?? lastSub;
            return (
              <div key={item.path}>
                {subhead}
                <NavLink
                  to={item.path}
                  onClick={onNavigate}
                  className={({ isActive }) => `nav-leaf${isActive ? ' active' : ''}`}
                >
                  {t(item.labelKey)}
                </NavLink>
              </div>
            );
          })}
          {showViewAll && (
            <NavLink
              to={section.hubPath as string}
              end
              onClick={onNavigate}
              className={({ isActive }) => `nav-leaf nav-viewall${isActive ? ' active' : ''}`}
            >
              {t('nav.viewAll', { total: sectionCount })}
            </NavLink>
          )}
        </div>
      )}
    </div>
  );
}
