import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, zip } from './zip';

function unzipWorks(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it('refuses unsafe and duplicate names', () => {
    expect(() => zip([{ path: '../x', content: '' }])).toThrow(/Unsafe/);
    expect(() => zip([{ path: '/abs', content: '' }])).toThrow(/Unsafe/);
    expect(() =>
      zip([
        { path: 'a', content: '' },
        { path: 'a', content: '' },
      ]),
    ).toThrow(/Duplicate/);
  });
  it.skipIf(!unzipWorks())(
    'produces an archive that unzip verifies and extracts byte for byte',
    () => {
      const files = {
        'script.R': 'cat("héllo 😀\\n")\n',
        'data/analysis-data.csv': 'a,b\n1,2\n',
        'empty.txt': '',
      };
      const bytes = zip(
        Object.entries(files).map(([path, content]) => ({ path, content })),
        new Date(2026, 10, 19, 12, 30, 42),
      );
      const dir = mkdtempSync(join(tmpdir(), 'sem-zip-'));
      writeFileSync(join(dir, 'b.zip'), bytes);
      expect(execFileSync('unzip', ['-t', 'b.zip'], { cwd: dir, encoding: 'utf8' })).toMatch(
        /No errors detected/,
      );
      execFileSync('unzip', ['-q', 'b.zip', '-d', 'out'], { cwd: dir });
      for (const [path, content] of Object.entries(files))
        expect(readFileSync(join(dir, 'out', path), 'utf8')).toBe(content);
    },
  );
});
