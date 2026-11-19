import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { useTheme } from '@/app/ThemeProvider';
import type { Theme, ThemePreference } from '@/app/theme';
import { Tooltip } from '@/components/ui';

import { BrandMark } from './BrandMark';
import { EngineStatus } from './EngineStatus';
import { NAV_GROUPS } from './navigation';

const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const NEXT: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { preference, resolved, cyclePreference } = useTheme();
  const ThemeIcon = THEME_ICONS[preference];
  const themeText = `Theme: ${THEME_LABELS[preference]}`;
  const themeHint = describeTheme(preference, resolved);
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside className="sidebar" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sidebar__brand">
        <BrandMark />
        <span className="sidebar__wordmark">
          <span className="sidebar__name">SEM Studio</span>
          <span className="sidebar__subtitle">Structural Equation Modeling</span>
        </span>
      </div>

      <nav className="sidebar__nav" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div
            key={group.label ?? group.items[0]?.path}
            className="sidebar__group"
            {...(group.label ? { role: 'group', 'aria-label': group.label } : {})}
          >
            {group.label ? (
              <p className="sidebar__group-label" aria-hidden="true">
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => (
              <Tooltip
                key={item.path}
                content={item.label}
                placement="right"
                delay={150}
                disabled={!collapsed}
              >
                <NavLink to={item.path} end={item.path === '/'} className="nav-item">
                  <item.icon size={18} aria-hidden="true" />
                  <span className="nav-item__label">{item.label}</span>
                </NavLink>
              </Tooltip>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar__utilities">
        <Tooltip content={themeHint} placement="right" delay={150}>
          <button
            type="button"
            className="nav-item"
            onClick={cyclePreference}
            aria-label={`${themeText}. Switch to ${THEME_LABELS[NEXT[preference]].toLowerCase()}.`}
          >
            <ThemeIcon size={18} aria-hidden="true" />
            <span className="nav-item__label">{themeText}</span>
          </button>
        </Tooltip>

        <EngineStatus />

        <Tooltip
          content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          placement="right"
          delay={150}
        >
          <button
            type="button"
            className="nav-item sidebar__collapse"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <CollapseIcon size={18} aria-hidden="true" />
            <span className="nav-item__label">Collapse</span>
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

function describeTheme(preference: ThemePreference, resolved: Theme): string {
  return preference === 'system'
    ? `Following the system (currently ${resolved}). Click to use light.`
    : `Click to switch to ${THEME_LABELS[NEXT[preference]].toLowerCase()}.`;
}
