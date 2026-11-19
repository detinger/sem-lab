import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addConstruct, addIndicators } from '@/domain/model-ops';
import type { ValidationIssue } from '@/domain/validation/validate';
import { type Readiness, summarize } from '@/features/data-lab/readiness';
import { useModeler } from './store';

const fitView = vi.fn();
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useReactFlow: () => ({ fitView }) };
});

const { CheckPanel } = await import('./CheckPanel');

const issue: ValidationIssue = {
  code: 'TEST_ISSUE',
  severity: 'error',
  layer: 'structural',
  title: 'PU and BI are not connected',
  explanation: 'Because.',
  fixes: ['Connect them.'],
  elementIds: ['c_pu', 'c_bi', 'r_missing'],
};

function readiness(issues: ValidationIssue[]): Readiness {
  return {
    issues,
    blocked: issues.some((i) => i.severity === 'error'),
    counts: summarize(issues),
    hasData: false,
  };
}

beforeEach(() => {
  fitView.mockClear();
  useModeler.getState().newProject('Check');
  useModeler.getState().edit(
    (m) => {
      let x = m;
      for (const name of ['PU', 'BI']) {
        const r = addConstruct(x, { name });
        x = addIndicators(r.model, r.id, [{ name: `${name}1` }]).model;
      }
      return x;
    },
    (l) => ({ ...l, nodes: { c_pu: { x: 0, y: 0 }, c_bi: { x: 300, y: 0 } } }),
  );
});

describe('Check model panel', () => {
  it('summarises the issues and says which kind of checks ran', () => {
    render(<CheckPanel readiness={readiness([issue])} onClose={() => undefined} />);
    expect(screen.getByRole('region', { name: 'Check model' })).toBeInTheDocument();
    expect(screen.getByText(/1 error · 0 warnings/)).toBeInTheDocument();
    expect(screen.getByText(/Method-independent checks only/)).toBeInTheDocument();
  });

  it('Focus element selects the element ids and fits the view to the nodes', async () => {
    const user = userEvent.setup();
    render(<CheckPanel readiness={readiness([issue])} onClose={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Focus element' }));
    expect(useModeler.getState().selection).toEqual(['c_pu', 'c_bi', 'r_missing']);
    expect(fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: 'c_pu' }, { id: 'c_bi' }] }),
    );
  });

  it('shows an all-clear row when there are no issues', () => {
    render(<CheckPanel readiness={readiness([])} onClose={() => undefined} />);
    expect(screen.getByText('No issues found in this model')).toBeInTheDocument();
  });
});
