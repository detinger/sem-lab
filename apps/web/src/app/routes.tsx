import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';
import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router-dom';

import { AppShell, type RouteHandle } from '@/app/shell/AppShell';
import { NAV_ITEMS } from '@/app/shell/navigation';
import { Spinner } from '@/components/ui';

import './routes.css';

// Every page is its own chunk: the shell loads first, a page's code only when it is opened.
const ModelerPage = lazy(() =>
  import('@/features/modeler/ModelerPage').then((m) => ({ default: m.ModelerPage })),
);
const DataPage = lazy(() => import('@/pages/DataPage').then((m) => ({ default: m.DataPage })));
const ComponentGallery = lazy(() =>
  import('@/pages/ComponentGallery').then((m) => ({ default: m.ComponentGallery })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);
const OverviewPage = lazy(() =>
  import('@/pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const AnalysisPage = lazy(() =>
  import('@/features/analysis/AnalysisPage').then((m) => ({ default: m.AnalysisPage })),
);
const ResultsPage = lazy(() =>
  import('@/features/results/ResultsPage').then((m) => ({ default: m.ResultsPage })),
);
const IpmaPage = lazy(() =>
  import('@/features/ipma/IpmaPage').then((m) => ({ default: m.IpmaPage })),
);
const ExamplesPage = lazy(() =>
  import('@/features/examples/ExamplesPage').then((m) => ({ default: m.ExamplesPage })),
);
const PlaceholderRoute: ComponentType<{ path: string }> = lazy(
  () => import('@/pages/PlaceholderRoute'),
);

function RouteLoading() {
  return (
    <div className="route-loading">
      <Spinner label="Loading page" size={16} />
    </div>
  );
}

const page = (element: ReactElement) => <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
const placeholder = (path: string) => page(<PlaceholderRoute path={path} />);

function titleOf(path: string): string {
  const item = NAV_ITEMS.find((n) => n.path === path);
  if (!item) throw new Error(`No navigation item for ${path}`);
  return item.label;
}

function child(path: string, element: RouteObject['element'], extra?: Partial<RouteHandle>) {
  const handle: RouteHandle = { title: titleOf(path), ...extra };
  return path === '/' ? { index: true, element, handle } : { path: path.slice(1), element, handle };
}

/**
 * The application's route table. The architect mounts the real Modeler by replacing the module
 * behind `@/features/modeler/ModelerPage`; the route is full-bleed (no page padding).
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      child('/', page(<OverviewPage />)),
      child('/modeler', page(<ModelerPage />), { fullBleed: true }),
      child('/data', page(<DataPage />)),
      child('/analysis', page(<AnalysisPage />)),
      child('/results', page(<ResultsPage />)),
      child('/ipma', page(<IpmaPage />)),
      child('/comparison', placeholder('/comparison')),
      child('/examples', page(<ExamplesPage />)),
      child('/learn', placeholder('/learn')),
      child('/challenges', placeholder('/challenges')),
      child('/reference', placeholder('/reference')),
      child('/settings', page(<SettingsPage />)),
      // Visual-review page; deliberately not in the sidebar.
      {
        path: 'dev/ui',
        element: page(<ComponentGallery />),
        handle: { title: 'Component gallery' } satisfies RouteHandle,
      },
      {
        path: '*',
        element: page(<NotFoundPage />),
        handle: { title: 'Page not found' } satisfies RouteHandle,
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}

/** For tests: the same route table on an in-memory history. */
export function createTestRouter(initialEntries: string[]) {
  return createMemoryRouter(routes, { initialEntries });
}
