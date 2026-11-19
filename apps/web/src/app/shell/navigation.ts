import {
  BookOpen,
  ChartColumnIncreasing,
  ChartScatter,
  FlaskConical,
  GitCompareArrows,
  LayoutDashboard,
  Library,
  NotebookTabs,
  Settings,
  Table,
  Target,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** Omitted for the standalone Overview item, which sits above the labelled groups. */
  label?: string;
  items: readonly NavItem[];
}

/** STYLE.md section 7 "Recommended sidebar". */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    items: [{ label: 'Overview', path: '/', icon: LayoutDashboard }],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Data', path: '/data', icon: Table },
      { label: 'Modeler', path: '/modeler', icon: Workflow },
      { label: 'Analysis', path: '/analysis', icon: FlaskConical },
      { label: 'Results', path: '/results', icon: ChartColumnIncreasing },
      { label: 'IPMA', path: '/ipma', icon: ChartScatter },
      { label: 'Comparison', path: '/comparison', icon: GitCompareArrows },
    ],
  },
  {
    label: 'Learn',
    items: [
      { label: 'Examples & Colab', path: '/examples', icon: NotebookTabs },
      { label: 'Lessons', path: '/learn', icon: BookOpen },
      { label: 'Challenges', path: '/challenges', icon: Target },
    ],
  },
  {
    label: 'Utilities',
    items: [
      { label: 'Reference', path: '/reference', icon: Library },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
