/**
 * Local-first project storage (PLAN §2.13, §2.2 privacy).
 *
 * Projects live in the browser's IndexedDB. Nothing here talks to a server. Datasets are
 * stored separately (Phase 2) and are never embedded in an exported project unless the user
 * explicitly opts in; the project file carries only the dataset fingerprint and schema.
 */
import { SCHEMA_VERSION, SemProject } from '@sem-studio/contracts';
import Dexie, { type EntityTable } from 'dexie';
import type { StoredRun } from '@/features/analysis/runs';
import type { StoredDataset } from './datasets';
import type { ChallengeProgress, LessonProgress, SkillRecord } from './learn';

export interface StoredProject {
  id: string;
  name: string;
  updatedAt: string;
  constructCount: number;
  indicatorCount: number;
  project: SemProject;
}

export const DB_NAME = 'sem-studio';

export class SemStudioDb extends Dexie {
  projects!: EntityTable<StoredProject, 'id'>;
  /** Phase 2: original tables + parse options + transformation log (see datasets.ts). */
  datasets!: EntityTable<StoredDataset, 'id'>;
  /** Phase 3: analysis run records (model snapshot, configuration, result); see features/analysis/runs.ts. */
  runs!: EntityTable<StoredRun, 'runId'>;
  /** Phase 6: learning progress (see storage/learn.ts). */
  lessonProgress!: EntityTable<LessonProgress, 'lessonId'>;
  challengeProgress!: EntityTable<ChallengeProgress, 'challengeId'>;
  skills!: EntityTable<SkillRecord, 'skill'>;
  constructor() {
    super(DB_NAME);
    // Keep every older version declared so existing browsers upgrade in place.
    this.version(1).stores({ projects: 'id, updatedAt, name' });
    this.version(2).stores({
      projects: 'id, updatedAt, name',
      datasets: 'id, fingerprint, importedAt',
    });
    this.version(3).stores({
      projects: 'id, updatedAt, name',
      datasets: 'id, fingerprint, importedAt',
      runs: 'runId, projectId, createdAt',
    });
    this.version(4).stores({
      projects: 'id, updatedAt, name',
      datasets: 'id, fingerprint, importedAt',
      runs: 'runId, projectId, createdAt',
      lessonProgress: 'lessonId',
      challengeProgress: 'challengeId, updatedAt',
      skills: 'skill',
    });
  }
}

let db: SemStudioDb | null = null;
/** The one shared connection to the 'sem-studio' IndexedDB database. */
export const getDb = (): SemStudioDb => (db ??= new SemStudioDb());

/** For tests: close and forget the connection so a fresh fake IndexedDB can be used. */
export function resetDbForTests(): void {
  db?.close();
  db = null;
}

export async function saveProject(project: SemProject): Promise<void> {
  const valid = SemProject.parse(project);
  await getDb().projects.put({
    id: valid.id,
    name: valid.name,
    updatedAt: valid.updatedAt,
    constructCount: valid.model.constructs.length,
    indicatorCount: valid.model.indicators.length,
    project: valid,
  });
}

export async function loadProject(id: string): Promise<SemProject | undefined> {
  const row = await getDb().projects.get(id);
  return row ? migrateProject(row.project) : undefined;
}

export async function listProjects(): Promise<Omit<StoredProject, 'project'>[]> {
  const rows = await getDb().projects.orderBy('updatedAt').reverse().toArray();
  return rows.map(({ project: _p, ...meta }) => meta);
}

export async function deleteProject(id: string): Promise<void> {
  await getDb().projects.delete(id);
}

// ---------------------------------------------------------------- file format

export const PROJECT_FILE_EXTENSION = '.semstudio.json';

export interface ProjectFile {
  format: 'sem-studio-project';
  formatVersion: 1;
  exportedAt: string;
  /** Always false in schema v1: data are never bundled implicitly. */
  includesData: false;
  project: SemProject;
}

export function toProjectFile(project: SemProject, now: string): string {
  const file: ProjectFile = {
    format: 'sem-studio-project',
    formatVersion: 1,
    exportedAt: now,
    includesData: false,
    project: SemProject.parse(project),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type ImportResult = { ok: true; project: SemProject } | { ok: false; error: string };

/** Parse and validate a project file. Never throws; returns a message suitable for the UI. */
export function parseProjectFile(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as { format?: unknown }).format !== 'sem-studio-project'
  ) {
    return { ok: false, error: 'This is not a SEM Studio project file.' };
  }
  const file = raw as Partial<ProjectFile>;
  if (file.formatVersion !== 1) {
    return { ok: false, error: `Unsupported project file version ${String(file.formatVersion)}.` };
  }
  const migrated = migrateProject(file.project);
  const parsed = SemProject.safeParse(migrated);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: `The project is invalid at ${first?.path.join('.') || '(root)'}: ${first?.message ?? 'unknown error'}`,
    };
  }
  return { ok: true, project: parsed.data };
}

/**
 * Schema migrations. v1 is the first version; future versions add steps here and keep a
 * fixture of every older version under packages/contracts/examples to test them.
 */
export function migrateProject(p: unknown): SemProject {
  const version = (p as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `No migration from project schema version ${String(version)} to ${SCHEMA_VERSION}.`,
    );
  }
  return p as SemProject;
}
