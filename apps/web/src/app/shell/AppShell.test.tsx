import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestRouter } from '@/app/routes';
import { THEME_STORAGE_KEY } from '@/app/theme';
import { installResizeObserverStub } from '@/tests/support/react-flow-dom';

import { NAV_GROUPS, NAV_ITEMS } from './navigation';
import { SIDEBAR_STORAGE_KEY } from './useSidebarCollapsed';

function renderAt(path: string) {
  return render(<RouterProvider router={createTestRouter([path])} />);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'light';
  // The Modeler route now mounts React Flow directly (no template picker), which needs a
  // ResizeObserver; jsdom has none, so stub it or the canvas throws and the page unmounts.
  installResizeObserverStub();
});

describe('navigation', () => {
  it('renders all 11 items in the STYLE.md groups and marks the active route', () => {
    renderAt('/ipma');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(NAV_ITEMS).toHaveLength(11);
    expect(within(nav).getAllByRole('link')).toHaveLength(11);
    for (const group of NAV_GROUPS) {
      if (!group.label) continue; // Overview sits on its own, above the labelled groups
      const region = within(nav).getByRole('group', { name: group.label });
      expect(
        within(region)
          .getAllByRole('link')
          .map((l) => l.textContent),
      ).toEqual(group.items.map((i) => i.label));
    }
    // Overview is a standalone link, not inside a labelled group.
    expect(within(nav).getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    const current = within(nav).getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('IPMA');
  });

  it('highlights Overview only on the exact root route', () => {
    renderAt('/reference');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Reference' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers a skip link to the main region', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });
});

describe('sidebar collapse', () => {
  it('toggles, persists, and restores on the next mount', async () => {
    const user = userEvent.setup();
    const first = renderAt('/');
    const shell = () => document.querySelector('.shell');
    expect(shell()).toHaveAttribute('data-sidebar', 'expanded');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(shell()).toHaveAttribute('data-sidebar', 'collapsed');
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');
    // Labels stay in the accessibility tree while collapsed.
    expect(screen.getByRole('link', { name: 'Modeler' })).toBeInTheDocument();

    first.unmount();
    renderAt('/');
    expect(shell()).toHaveAttribute('data-sidebar', 'collapsed');
    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('false');
  });
});

describe('theme', () => {
  it('cycles light, dark, system and sets data-theme on <html>', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderAt('/');
    const toggle = () => screen.getByRole('button', { name: /^Theme:/ });
    expect(toggle()).toHaveTextContent('Theme: Light');
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(toggle());
    expect(toggle()).toHaveTextContent('Theme: Dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(toggle());
    expect(toggle()).toHaveTextContent('Theme: System');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);

    await user.click(toggle());
    expect(toggle()).toHaveTextContent('Theme: Light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    renderAt('/');
    expect(screen.getByRole('button', { name: /^Theme:/ })).toHaveTextContent(/System|Light|Dark/);
  });
});

describe('routes', () => {
  const HEADINGS: [string, string][] = [
    ['/', 'Overview'],
    ['/modeler', 'Modeler'],
    ['/data', 'Data'],
    ['/analysis', 'Analysis'],
    ['/results', 'Results'],
    ['/ipma', 'IPMA'],
    ['/comparison', 'Comparison'],
    ['/examples', 'Examples'],
    ['/learn', 'Lessons'],
    ['/challenges', 'Challenges'],
    ['/reference', 'Reference'],
    ['/dev/ui', 'Component gallery'],
    ['/no/such/page', 'Page not found'],
  ];

  // Pages are lazy chunks, so their heading appears after the chunk has loaded.
  it.each(HEADINGS)('%s renders the heading "%s"', async (path, heading) => {
    renderAt(path);
    expect(
      await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('/examples is the Examples gallery, not a placeholder', async () => {
    renderAt('/examples');
    expect(await screen.findByRole('heading', { level: 1, name: 'Examples' })).toBeInTheDocument();
    expect(screen.queryByText('Planned for Phase 6')).not.toBeInTheDocument();
  });

  it('/comparison names its roadmap phase', async () => {
    renderAt('/comparison');
    expect(await screen.findByText('Planned for Phase 5')).toBeInTheDocument();
  });

  it.each(['/learn', '/learn/no-such-lesson', '/challenges', '/challenges/none', '/reference'])(
    '%s is a real page, not a Phase 6 placeholder',
    async (path) => {
      renderAt(path);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText('Planned for Phase 6')).not.toBeInTheDocument();
    },
  );

  it('Overview links the four workflow steps and shows an empty recent-projects state', async () => {
    renderAt('/');
    await screen.findByText('No projects yet');
    const hrefs = ['/data', '/modeler', '/analysis', '/results'];
    for (const href of hrefs) {
      expect(
        screen
          .getAllByRole('link')
          .some((l) => l.getAttribute('href') === href && /Step/.test(l.textContent ?? '')),
      ).toBe(true);
    }
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
  });
});
