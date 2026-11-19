import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router-dom';

import { AppShell, type RouteHandle } from '@/app/shell/AppShell';
import { NAV_ITEMS } from '@/app/shell/navigation';
import { ModelerPage } from '@/features/modeler/ModelerPage';
import { ComponentGallery } from '@/pages/ComponentGallery';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { placeholderElement } from '@/pages/placeholderRoutes';
import { SettingsPage } from '@/pages/SettingsPage';

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
      child('/', <OverviewPage />),
      child('/modeler', <ModelerPage />, { fullBleed: true }),
      child('/data', placeholderElement('/data')),
      child('/analysis', placeholderElement('/analysis')),
      child('/results', placeholderElement('/results')),
      child('/ipma', placeholderElement('/ipma')),
      child('/comparison', placeholderElement('/comparison')),
      child('/examples', placeholderElement('/examples')),
      child('/learn', placeholderElement('/learn')),
      child('/challenges', placeholderElement('/challenges')),
      child('/reference', placeholderElement('/reference')),
      child('/settings', <SettingsPage />),
      // Visual-review page; deliberately not in the sidebar.
      {
        path: 'dev/ui',
        element: <ComponentGallery />,
        handle: { title: 'Component gallery' } satisfies RouteHandle,
      },
      {
        path: '*',
        element: <NotFoundPage />,
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
