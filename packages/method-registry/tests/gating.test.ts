import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnalysisConfiguration, SemModel } from '@sem-lab/contracts';
import { describe, expect, it } from 'vitest';
import { requiredCapabilities } from '../src/index.ts';

const vectors = JSON.parse(
  readFileSync(join(__dirname, '..', 'gating-vectors.json'), 'utf8'),
) as Array<{
  name: string;
  model: unknown;
  analysis: unknown;
  expected: string[];
}>;

describe('requiredCapabilities (shared vectors; the API port is tested against the same file)', () => {
  for (const v of vectors) {
    it(v.name, () => {
      expect(
        requiredCapabilities(SemModel.parse(v.model), AnalysisConfiguration.parse(v.analysis)),
      ).toEqual(v.expected);
    });
  }
});
