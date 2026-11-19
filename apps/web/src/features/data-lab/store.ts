/**
 * Data Lab state: the ACTIVE dataset lives here, in memory, and nowhere else.
 *
 * Privacy (overview.md ground rule 3): row-level data is never written to a project file, a
 * URL, localStorage or a log. Only `toDatasetRef(dataset)` (fingerprint + column schema) goes
 * into the project, through the modeler store. The dataset itself is stored in this browser's
 * IndexedDB (storage/datasets.ts) so the project can find it again by fingerprint.
 *
 * Error messages set here are fixed sentences or come from the domain layer, which names
 * columns and counts but never cell values.
 */
import { create } from 'zustand';
import { useModeler } from '@/features/modeler/store';
import { bundledDatasetInfo, loadBundledCsv } from '@/domain/dataset/bundled';
import { DEFAULT_MAX_BYTES } from '@/domain/dataset/parse';
import { profileDataset } from '@/domain/dataset/stats';
import { createDataset, isDatasetError, withTransformations } from '@/domain/dataset/transform';
import type {
  ColumnProfile,
  Dataset,
  ParseIssue,
  ParseOptions,
  Transformation,
} from '@/domain/dataset/types';
import { listDatasets, loadDataset, saveDataset, toDatasetRef } from '@/storage/datasets';
import type { DatasetRef, SemModel } from '@sem-lab/contracts';

/** The text of the latest import attempt, kept in memory only so options can be overridden. */
export interface ImportDraft {
  text: string;
  name: string;
  source: Dataset['source'];
}

export type LinkState = 'none' | 'unlinked' | 'verified' | 'missing' | 'mismatch';

export interface DataLabState {
  dataset: Dataset | null;
  profiles: ColumnProfile[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** fixed sentence about the last failed operation; never contains cell values */
  error: string | null;
  /** issues of the last parse attempt (also when it failed) */
  parseIssues: ParseIssue[];
  draft: ImportDraft | null;
  /** options used for the last attempt (undefined fields = detect) */
  draftOptions: ParseOptions;
  /** a stored copy could not be written to IndexedDB (the session still works) */
  storageWarning: string | null;

  importFile: (file: File) => Promise<void>;
  importBundled: (id: string) => Promise<void>;
  importText: (
    text: string,
    meta: Omit<ImportDraft, 'text'>,
    options?: ParseOptions,
  ) => Promise<void>;
  reparse: (options: ParseOptions) => Promise<void>;
  /** replace the transformation log; resolves to an error sentence, or null on success */
  setTransformations: (next: Transformation[]) => Promise<string | null>;
  /** look the project's dataset up in this browser by fingerprint */
  restoreFor: (ref: DatasetRef | undefined) => Promise<void>;
  /** link the active dataset to the open project */
  linkToProject: () => void;
  clear: () => void;
}

let token = 0;

const EMPTY = {
  dataset: null,
  profiles: [],
  status: 'idle' as const,
  error: null,
  parseIssues: [],
  draft: null,
  draftOptions: {},
  storageWarning: null,
};

export const useDataLab = create<DataLabState>()((set, get) => {
  async function persist(dataset: Dataset): Promise<string | null> {
    try {
      await saveDataset(dataset);
      return null;
    } catch {
      return 'The data could not be stored in this browser. It stays available until you leave this page.';
    }
  }

  /** Reuse the stored record of an identical table instead of piling up duplicates. */
  async function dedupe(dataset: Dataset): Promise<Dataset> {
    try {
      const hit = (await listDatasets()).find((d) => d.fingerprint === dataset.fingerprint);
      return hit ? { ...dataset, id: hit.id } : dataset;
    } catch {
      return dataset;
    }
  }

  async function accept(dataset: Dataset, draft: ImportDraft | null): Promise<void> {
    const stored = await dedupe(dataset);
    const storageWarning = await persist(stored);
    const modeler = useModeler.getState();
    const ref = modeler.datasetRef;
    const current = get().dataset;
    // A project that already points at data we are waiting for is only VERIFIED against the
    // new import, never silently re-linked.
    const awaiting =
      ref !== undefined && (current === null || current.fingerprint !== ref.fingerprint);
    set({
      dataset: stored,
      profiles: profileDataset(stored),
      status: 'ready',
      error: null,
      parseIssues: stored.parse.issues,
      draft,
      storageWarning,
    });
    if (!awaiting) modeler.setDatasetRef(toDatasetRef(stored));
  }

  return {
    ...EMPTY,

    async importText(text, meta, options = {}) {
      const mine = ++token;
      set({ status: 'loading', error: null, draft: { text, ...meta }, draftOptions: options });
      const existing = get().dataset;
      const result = await createDataset(text, {
        name: meta.name,
        source: meta.source,
        options,
        ...(existing && existing.source === meta.source ? { id: existing.id } : {}),
      });
      if (mine !== token) return;
      if (isDatasetError(result)) {
        set({
          status: 'error',
          error: result.error.issues?.length
            ? 'This file cannot be used as it is. Fix the problems below or change the parse options.'
            : result.error.message,
          parseIssues: result.error.issues ?? [],
        });
        return;
      }
      await accept(result, { text, ...meta });
    },

    async importFile(file) {
      if (file.size > DEFAULT_MAX_BYTES) {
        set({
          status: 'error',
          draft: null,
          error: `This file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${DEFAULT_MAX_BYTES / 1048576} MB. Use a smaller extract, or remove columns you do not need.`,
          parseIssues: [],
        });
        return;
      }
      set({ status: 'loading', error: null });
      let text: string;
      try {
        text = await file.text();
      } catch {
        set({ status: 'error', error: 'The file could not be read.', parseIssues: [] });
        return;
      }
      await get().importText(text, {
        name: file.name.replace(/\.(csv|txt|tsv)$/i, '') || 'Imported data',
        source: { kind: 'file', fileName: file.name },
      });
    },

    async importBundled(id) {
      const info = bundledDatasetInfo(id);
      if (!info) return;
      set({ status: 'loading', error: null });
      let text: string;
      try {
        text = await loadBundledCsv(id);
      } catch {
        set({ status: 'error', error: 'The sample dataset could not be loaded.', parseIssues: [] });
        return;
      }
      await get().importText(text, {
        name: info.title,
        source: { kind: 'bundled', exampleId: id },
      });
    },

    async reparse(options) {
      const draft = get().draft;
      if (!draft) return;
      await get().importText(draft.text, { name: draft.name, source: draft.source }, options);
    },

    async setTransformations(next) {
      const dataset = get().dataset;
      if (!dataset) return 'No dataset is loaded.';
      const result = await withTransformations(dataset, next);
      if (isDatasetError(result)) return result.error.message;
      const storageWarning = await persist(result);
      set({
        dataset: result,
        profiles: profileDataset(result),
        storageWarning,
      });
      useModeler.getState().setDatasetRef(toDatasetRef(result));
      return null;
    },

    async restoreFor(ref) {
      if (!ref) return;
      if (get().dataset?.fingerprint === ref.fingerprint) return;
      const mine = ++token;
      set({ status: 'loading', error: null });
      let found: Dataset | undefined;
      try {
        const hit = (await listDatasets()).find((d) => d.fingerprint === ref.fingerprint);
        found = hit ? await loadDataset(hit.id) : undefined;
      } catch {
        found = undefined;
      }
      if (mine !== token) return;
      if (found && found.fingerprint === ref.fingerprint) {
        set({
          dataset: found,
          profiles: profileDataset(found),
          status: 'ready',
          parseIssues: found.parse.issues,
          draft: null,
          draftOptions: {},
        });
      } else {
        set({ ...EMPTY });
      }
    },

    linkToProject() {
      const ds = get().dataset;
      if (ds) useModeler.getState().setDatasetRef(toDatasetRef(ds));
    },

    clear() {
      token++;
      set({ ...EMPTY });
    },
  };
});

/** How the open project's data link relates to the data in memory (derived, never stored). */
export function linkStateOf(ref: DatasetRef | undefined, dataset: Dataset | null): LinkState {
  if (!ref) return dataset ? 'unlinked' : 'none';
  if (!dataset) return 'missing';
  return dataset.fingerprint === ref.fingerprint ? 'verified' : 'mismatch';
}

/** One undoable model edit through the modeler store (mapping and scale edits). */
export function editModel(fn: (m: SemModel) => SemModel): boolean {
  return useModeler.getState().edit(fn);
}
