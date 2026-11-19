import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigPanel } from '@/features/analysis/ConfigPanel';
import { defaultConfig, toConfiguration } from '@/features/analysis/config';
import { TAM_MODEL } from '@/features/analysis/test-support';
import { useModeler } from '@/features/modeler/store';

const panel = (method: 'pls-sem' | 'plsc', ipmaTarget = '') =>
  render(
    <MemoryRouter>
      <ConfigPanel
        config={{ ...defaultConfig(1), method, ipmaTarget }}
        problems={{}}
        onChange={() => undefined}
        maxBootstrap={null}
      />
    </MemoryRouter>,
  );

beforeEach(() => {
  useModeler.getState().newProject('t');
  useModeler.getState().edit(() => TAM_MODEL);
});

describe('IPMA config', () => {
  it('offers only constructs with a predecessor, enabled for PLS-SEM', () => {
    panel('pls-sem');
    const select = screen.getByLabelText('Target construct');
    expect(select).toBeEnabled();
    const options = [...(select as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['No IPMA', 'PU', 'BI']);
  });

  it('is disabled for PLSc with the reason', () => {
    panel('plsc');
    expect(screen.getByLabelText('Target construct')).toBeDisabled();
    expect(screen.getByText('IPMA uses a classic PLS fit')).toBeInTheDocument();
  });

  it('adds ipma to the configuration for PLS-SEM only', () => {
    const ok = toConfiguration({ ...defaultConfig(1), ipmaTarget: 'c_bi' });
    expect(ok.ok && ok.analysis.ipma).toEqual({ targetConstructId: 'c_bi' });
    const plsc = toConfiguration({ ...defaultConfig(1), method: 'plsc', ipmaTarget: 'c_bi' });
    expect(plsc.ok && plsc.analysis.ipma).toBeUndefined();
  });
});

describe('IPMA config while the registry does not offer it', () => {
  it('is disabled with the registry reason and no ipma is sent', async () => {
    vi.resetModules();
    vi.doMock('@sem-studio/method-registry', async (orig) => ({
      ...(await orig<Record<string, unknown>>()),
      isOffered: (id: string) => (id === 'ipma.construct' ? false : true),
      unavailableReason: (id: string) =>
        id === 'ipma.construct' ? 'Planned for a later release.' : undefined,
    }));
    const { ConfigPanel: Panel } = await import('@/features/analysis/ConfigPanel');
    const cfg = await import('@/features/analysis/config');
    render(
      <MemoryRouter>
        <Panel
          config={{ ...cfg.defaultConfig(1), ipmaTarget: 'c_bi' }}
          problems={{}}
          onChange={() => undefined}
          maxBootstrap={null}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Target construct')).toBeDisabled();
    expect(screen.getByText('Planned for a later release.')).toBeInTheDocument();
    const r = cfg.toConfiguration({ ...cfg.defaultConfig(1), ipmaTarget: 'c_bi' });
    expect(r.ok && r.analysis.ipma).toBeUndefined();
    vi.doUnmock('@sem-studio/method-registry');
  });
});
