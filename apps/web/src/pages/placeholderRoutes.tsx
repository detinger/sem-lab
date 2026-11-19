import { NAV_ITEMS } from '@/app/shell/navigation';

import { PlaceholderPage } from './PlaceholderPage';

interface Spec {
  path: string;
  description: string;
  phase: string;
  willContain: string;
}

/** Roadmap phases follow PLAN.md section 5. */
export const PLACEHOLDER_SPECS: readonly Spec[] = [
  {
    path: '/data',
    phase: 'Phase 2',
    description: 'Import a CSV file, map columns to indicators and check data quality.',
    willContain:
      'CSV import, column mapping, missing-value and quality diagnostics, and transformations. Imported data stays in your browser.',
  },
  {
    path: '/analysis',
    phase: 'Phase 3',
    description: 'Configure an estimation run and follow it from start to finish.',
    willContain:
      'Algorithm settings, bootstrap options and a run queue with honest status for each run.',
  },
  {
    path: '/results',
    phase: 'Phase 3',
    description: 'Reliability, paths, fit and prediction for a completed run.',
    willContain:
      'Run provenance, measurement and structural tables, and copyable tables for reports.',
  },
  {
    path: '/ipma',
    phase: 'Phase 4',
    description: 'Importance-performance map analysis.',
    willContain:
      'A target-construct selector, an importance-performance map and a linked data table.',
  },
  {
    path: '/comparison',
    phase: 'Phase 5',
    description: 'Compare methods and models side by side.',
    willContain: 'Side-by-side results for PLS-SEM and CB-SEM runs on the same model.',
  },
  {
    path: '/examples',
    phase: 'Phase 6',
    description: 'Worked example models and companion Python notebooks.',
    willContain:
      'Example models with synthetic teaching data and links to Google Colab notebooks once they are hosted.',
  },
  {
    path: '/learn',
    phase: 'Phase 6',
    description: 'Progressive lessons on structural equation modeling.',
    willContain:
      'Short lessons with a miniature interactive diagram, a common-mistake note and a knowledge check.',
  },
  {
    path: '/challenges',
    phase: 'Phase 6',
    description: 'Practice modeling, diagnosing and interpreting.',
    willContain: 'Challenges to model, diagnose, analyze, interpret and report, with hints.',
  },
  {
    path: '/reference',
    phase: 'Phase 6',
    description: 'A statistical glossary and method reference.',
    willContain: 'Definitions of the measures and methods used in SEM Studio, with citations.',
  },
];

export function placeholderElement(path: string) {
  const spec = PLACEHOLDER_SPECS.find((s) => s.path === path);
  const nav = NAV_ITEMS.find((n) => n.path === path);
  if (!spec || !nav) throw new Error(`No placeholder spec for ${path}`);
  return (
    <PlaceholderPage
      title={nav.label}
      icon={nav.icon}
      description={spec.description}
      phase={spec.phase}
      willContain={spec.willContain}
    />
  );
}
