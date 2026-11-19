import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Demo } from '../DemoBlock';
import type { DemoId } from '../schema';

vi.mock('../diagram', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  modelSvg: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
}));

const show = (id: DemoId, initial = {}) =>
  render(
    <MemoryRouter>
      <Demo id={id} initial={initial} />
    </MemoryRouter>,
  );
const readout = (label: string) => {
  const el = screen.getByText(label).closest('.demo-readout') as HTMLElement;
  return el.querySelector('.demo-readout__value')?.textContent;
};
const slide = (name: RegExp | string, v: number) =>
  fireEvent.change(screen.getByRole('slider', { name }), { target: { value: String(v) } });

describe('demos show live numbers from the formulas', () => {
  it('reliability: four loadings of .8 give α .877, ρC .877, AVE .640', () => {
    show('reliability-from-loadings', { loadings: [0.8, 0.8, 0.8, 0.8] });
    expect(readout('Cronbach’s α (standardized)')).toBe('0.877');
    expect(readout('Composite reliability ρC')).toBe('0.877');
    expect(readout('AVE')).toBe('0.640');
    expect(screen.getAllByRole('slider')).toHaveLength(4);
    expect(screen.getByText(/heuristics, not tests/)).toBeInTheDocument();
    slide('Loading λ1', 0.5);
    expect(readout('AVE')).toBe('0.543'); // (.25 + 3·.64) / 4 = .5425
  });

  it('reliability: k can be changed between 3 and 6', async () => {
    const user = userEvent.setup();
    show('reliability-from-loadings');
    expect(screen.getAllByRole('slider')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Add indicator' }));
    await user.click(screen.getByRole('button', { name: 'Add indicator' }));
    expect(screen.getAllByRole('slider')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Add indicator' })).toBeDisabled();
  });

  it('htmt, vif, f²', () => {
    const a = show('htmt', { heterotrait: 0.6, monotraitA: 0.64, monotraitB: 0.81 });
    expect(readout('HTMT')).toBe('0.833');
    a.unmount();
    const b = show('vif', { r2: 0.8 });
    expect(readout('VIF')).toBe('5.00');
    expect(screen.getAllByText(/5 or higher/).length).toBeGreaterThan(0);
    b.unmount();
    show('f2', { r2Included: 0.5, r2Excluded: 0.4 });
    expect(readout('f²')).toBe('0.200');
    expect(screen.getAllByText(/medium/).length).toBeGreaterThan(0);
  });

  it('mediation: effects and the Zhao et al. type follow the toggles and signs', async () => {
    const user = userEvent.setup();
    show('mediation', { a: 0.5, b: 0.4, cPrime: 0.2 });
    expect(readout('Indirect effect a·b')).toBe('0.200');
    expect(readout('Total effect c′ + a·b')).toBe('0.400');
    expect(readout('Mediation type')).toBe('complementary');
    slide(/c′: direct/, -0.2);
    expect(readout('Mediation type')).toBe('competitive');
    await user.click(screen.getByRole('checkbox', { name: 'Direct effect significant' }));
    expect(readout('Mediation type')).toBe('indirect only');
    await user.click(screen.getByRole('checkbox', { name: 'Indirect effect significant' }));
    expect(readout('Mediation type')).toBe('no effect');
    await user.click(screen.getByRole('checkbox', { name: 'Direct effect significant' }));
    expect(readout('Mediation type')).toBe('direct only');
  });

  it('bootstrap is deterministic for a seed and changes with it', async () => {
    const user = userEvent.setup();
    const first = show('bootstrap', { draws: 500, seed: 42 });
    const ci = readout('95% percentile CI');
    const se = readout('Bootstrap SE');
    first.unmount();
    show('bootstrap', { draws: 500, seed: 42 });
    expect(readout('95% percentile CI')).toBe(ci);
    expect(readout('Bootstrap SE')).toBe(se);
    expect(
      screen.getByRole('img', { name: /Histogram of 500 bootstrap statistics/ }),
    ).toBeInTheDocument();
    const seed = screen.getByLabelText('Seed');
    await user.clear(seed);
    await user.type(seed, '43');
    expect(readout('Bootstrap SE')).not.toBe(se);
    await user.clear(seed);
    await user.type(seed, 'abc');
    expect(screen.getAllByText(/whole number from 0/).length).toBeGreaterThan(0);
  });

  it('ipma-rescale: declared versus observed endpoints', () => {
    show('ipma-rescale', { min: 1, max: 7, observedMin: 3, observedMax: 7, mean: 5.5 });
    expect(readout('With declared endpoints')).toBe('75.0');
    expect(readout('With observed extrema')).toBe('62.5');
    expect(screen.getByText(/misleading/)).toBeInTheDocument();
  });

  it('rmsea-cfi uses the engine formulas', () => {
    show('rmsea-cfi', { chi2: 85, df: 40, n: 300, chi2Base: 1200, dfBase: 55 });
    // sqrt((85/40 − 1)/300) = 0.0611…; CFI = 1 − 45/1145
    expect(readout('RMSEA')).toBe('0.061');
    expect(readout('CFI')).toBe('0.961');
    expect(screen.getByText(/lavaan conventions/)).toBeInTheDocument();
  });

  it('reflective-formative flips the arrows description and the consequences', async () => {
    const user = userEvent.setup();
    show('reflective-formative');
    expect(screen.getByText(/the construct causes its indicators/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Formative' }));
    expect(screen.getByText(/the indicators form the construct/)).toBeInTheDocument();
    expect(within(screen.getByRole('region')).getByText(/outer weights/)).toBeInTheDocument();
  });

  it('every demo is labelled as an interactive demo and every slider has a name', () => {
    for (const id of [
      'reliability-from-loadings',
      'htmt',
      'vif',
      'f2',
      'mediation',
      'bootstrap',
      'ipma-rescale',
      'rmsea-cfi',
    ] as const) {
      const r = show(id);
      expect(screen.getByRole('region', { name: /^Interactive demo:/ })).toBeInTheDocument();
      for (const s of screen.getAllByRole('slider')) expect(s).toHaveAccessibleName();
      r.unmount();
    }
  });
});
