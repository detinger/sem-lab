import { lazy, Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation, useMatches } from 'react-router-dom';

import { ThemeProvider } from '@/app/ThemeProvider';
import { ToastProvider } from '@/components/ui';
import { cx } from '@/components/ui';
import { DOCK_PATHS, useActiveChallenge } from '@/features/learn/active';

import { NAV_GROUPS } from './navigation';
import { Sidebar } from './Sidebar';
import { useSidebarCollapsed } from './useSidebarCollapsed';
import './shell.css';

// The docked challenge panel is only loaded once a challenge has been started.
const ChallengeDock = lazy(() => import('@/features/learn/ChallengeDock'));

/** Route metadata read by the shell. Routes attach it as `handle`. */
export interface RouteHandle {
  title: string;
  /** Full-bleed pages (the Modeler) get the whole main region with no padding. */
  fullBleed?: boolean;
}

function isRouteHandle(value: unknown): value is RouteHandle {
  return typeof value === 'object' && value !== null && 'title' in value;
}

function ShellFrame() {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const main = useRef<HTMLElement>(null);
  const matches = useMatches();
  const { pathname } = useLocation();
  const activeChallenge = useActiveChallenge((s) => s.challengeId);
  const showDock = activeChallenge !== null && DOCK_PATHS.some((p) => pathname === p);
  const handle = matches.map((m) => m.handle).findLast(isRouteHandle);
  const title = handle?.title ?? 'Page not found';
  const group = NAV_GROUPS.find((g) => g.items.some((item) => item.label === title))?.label;

  useEffect(() => {
    document.title = `${title} · SEM Studio`;
  }, [title]);

  return (
    <div className="shell" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      <div className="shell__column">
        <div className="shell__header" role="presentation">
          {group ? <span className="shell__crumb">{group}</span> : null}
          {group ? (
            <span className="shell__crumb-sep" aria-hidden="true">
              /
            </span>
          ) : null}
          <span className="shell__title">{title}</span>
        </div>
        <div className="shell__body">
          <main
            id="main-content"
            ref={main}
            tabIndex={-1}
            className={cx('shell__main', handle?.fullBleed && 'shell__main--bleed')}
          >
            {handle?.fullBleed ? (
              <Outlet />
            ) : (
              <div className="page">
                <Outlet />
              </div>
            )}
          </main>
          {showDock ? (
            <Suspense fallback={null}>
              <ChallengeDock />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ShellFrame />
      </ToastProvider>
    </ThemeProvider>
  );
}
