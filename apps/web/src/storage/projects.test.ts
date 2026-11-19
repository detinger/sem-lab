import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SemProject } from '@sem-studio/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteProject,
  listProjects,
  loadProject,
  parseProjectFile,
  resetDbForTests,
  saveProject,
  toProjectFile,
} from './projects';

const example = SemProject.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'packages',
        'contracts',
        'examples',
        'valid',
        'project.tam-v1.json',
      ),
      'utf8',
    ),
  ),
);

afterEach(() => resetDbForTests());

describe('IndexedDB project store', () => {
  it('saves, lists newest first, loads and deletes', async () => {
    await saveProject({ ...example, id: 'p_old', updatedAt: '2026-01-01T00:00:00Z' });
    await saveProject({
      ...example,
      id: 'p_new',
      name: 'Newer',
      updatedAt: '2026-06-01T00:00:00Z',
    });
    const list = await listProjects();
    expect(list.map((p) => p.id).slice(0, 2)).toEqual(['p_new', 'p_old']);
    expect(list[0]).toMatchObject({ name: 'Newer', constructCount: 5, indicatorCount: 22 });
    expect(list[0]).not.toHaveProperty('project');
    expect(await loadProject('p_old')).toEqual({
      ...example,
      id: 'p_old',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    await deleteProject('p_old');
    expect(await loadProject('p_old')).toBeUndefined();
  });
  it('refuses to store an invalid project', async () => {
    await expect(
      saveProject({
        ...example,
        model: { ...example.model, constructs: [{ id: 'bad id' }] },
      } as never),
    ).rejects.toThrow();
  });
});

describe('project files', () => {
  it('round-trips through the file format without data', () => {
    const text = toProjectFile(example, '2026-11-19T12:00:00Z');
    expect(JSON.parse(text)).toMatchObject({
      format: 'sem-studio-project',
      formatVersion: 1,
      includesData: false,
    });
    const back = parseProjectFile(text);
    expect(back).toEqual({ ok: true, project: example });
  });
  it.each([
    ['not json', '{', /not valid JSON/],
    ['foreign json', '{"hello":1}', /not a SEM Studio project/],
    [
      'future format',
      JSON.stringify({ format: 'sem-studio-project', formatVersion: 9 }),
      /Unsupported project file version/,
    ],
    [
      'invalid model',
      JSON.stringify({
        format: 'sem-studio-project',
        formatVersion: 1,
        project: {
          ...example,
          model: {
            ...example.model,
            relationships: [{ id: 'r', kind: 'measurement', sourceId: 'a', targetId: 'b' }],
          },
        },
      }),
      /invalid at model\.relationships/,
    ],
  ])('rejects %s with a readable message', (_label, text, message) => {
    const r = parseProjectFile(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });
});
