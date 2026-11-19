import { SemModel, validateModelStructure } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './templates';

describe.each(TEMPLATES)('template $id', (t) => {
  it('builds a contract-valid, structurally valid model without scale endpoints', () => {
    const m = t.build();
    expect(SemModel.safeParse(m).success).toBe(true);
    expect(validateModelStructure(m)).toEqual([]);
    expect(m.indicators.every((i) => i.scale === undefined)).toBe(true);
  });
});

describe('TAM template', () => {
  it('binds indicators to the column names of the bundled TAM data', () => {
    const m = TEMPLATES.find((t) => t.id === 'tam')!.build();
    expect(m.indicators.map((i) => i.column)).toContain('USEF1');
    expect(
      m.relationships.map((r) => (r.kind === 'structural' ? r.hypothesis : undefined)),
    ).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  });
});
