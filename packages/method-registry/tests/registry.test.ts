import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { METHOD_CAPABILITY, registry } from '../src/index.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('capability registry integrity', () => {
  it('has unique capability ids', () => {
    const ids = registry.capabilities.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares every engine it references', () => {
    const declared = new Set(registry.engines.map((e) => e.id));
    for (const c of registry.capabilities)
      for (const e of Object.keys(c.engines)) expect(declared, `${c.id} → ${e}`).toContain(e);
  });

  it('defines every method-gating capability', () => {
    for (const id of Object.values(METHOD_CAPABILITY))
      expect(registry.capabilities.map((c) => c.id)).toContain(id);
  });

  for (const c of registry.capabilities) {
    for (const [engine, e] of Object.entries(c.engines)) {
      const where = `${c.id} @ ${engine}`;
      it(`${where}: status "${e.status}" is backed by "${e.verification}" evidence`, () => {
        if (e.status === 'supported') {
          expect(e.verification, `${where}: supported requires reference-tested`).toBe(
            'reference-tested',
          );
          expect(e.evidence.length, `${where}: supported requires evidence`).toBeGreaterThan(0);
        }
        if (e.status === 'beta')
          expect(['reference-tested', 'engine-verified'], where).toContain(e.verification);
        if (e.status === 'unsupported')
          expect(e.reason, `${where}: unsupported requires a reason`).toBeTruthy();
        if (e.verification !== 'none')
          expect(e.evidence.length, `${where}: verification claims need evidence`).toBeGreaterThan(
            0,
          );
        for (const p of e.evidence)
          expect(existsSync(join(repoRoot, p)), `${where}: evidence path missing: ${p}`).toBe(true);
      });
    }
  }

  it('resolves every citation key', () => {
    const keys = new Set(registry.citations.map((c) => c.key));
    for (const c of registry.capabilities)
      for (const r of c.references) expect(keys, `${c.id} cites ${r}`).toContain(r);
  });
});
