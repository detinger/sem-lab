/**
 * Learning content store. Real content is loaded eagerly from content/ (lessons, challenges,
 * reference, citations) and validated with the Zod schemas in ./schema.ts; an invalid or missing
 * file is skipped with a console warning, so the app renders (with empty states) while content
 * is being written. In development a test-only fixture set can replace the real content
 * (localStorage key `sem-studio:learn-fixtures` = "1"), which the Playwright specs use.
 */
import { registry } from '@sem-studio/method-registry';
import { create } from 'zustand';
import {
  Challenge,
  Citations,
  Glossary,
  type Citation,
  type GlossaryTerm,
  Lesson,
  Theories,
  type Theory,
} from './schema';

export interface ContentSet {
  lessons: Lesson[];
  challenges: Challenge[];
  glossary: GlossaryTerm[];
  theories: Theory[];
  citations: Citation[];
}

const lessonFiles = import.meta.glob<unknown>('../../../../../content/lessons/*.json', {
  eager: true,
  import: 'default',
});
const challengeFiles = import.meta.glob<unknown>('../../../../../content/challenges/*.json', {
  eager: true,
  import: 'default',
});
const glossaryFiles = import.meta.glob<unknown>('../../../../../content/reference/glossary.json', {
  eager: true,
  import: 'default',
});
const theoryFiles = import.meta.glob<unknown>('../../../../../content/reference/theories.json', {
  eager: true,
  import: 'default',
});
const citationFiles = import.meta.glob<unknown>('../../../../../content/citations/citations.json', {
  eager: true,
  import: 'default',
});

type Parsed<T> = { success: true; data: T } | { success: false; error: { message: string } };

function parseAll<T>(files: Record<string, unknown>, parse: (raw: unknown) => Parsed<T>): T[] {
  const out: T[] = [];
  for (const [path, raw] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const r = parse(raw);
    if (r.success) out.push(r.data);
    else console.warn(`Skipping invalid content file ${path}: ${r.error.message.slice(0, 300)}`);
  }
  return out;
}

export interface ContentFiles {
  lessons: Record<string, unknown>;
  challenges: Record<string, unknown>;
  glossary: Record<string, unknown>;
  theories: Record<string, unknown>;
  citations: Record<string, unknown>;
}

/** Validate raw content files; invalid ones are skipped with a warning. */
export function loadContent(
  files: ContentFiles = {
    lessons: lessonFiles,
    challenges: challengeFiles,
    glossary: glossaryFiles,
    theories: theoryFiles,
    citations: citationFiles,
  },
): ContentSet {
  return {
    lessons: parseAll(files.lessons, (r) => Lesson.safeParse(r)).sort(
      (a, b) => a.level - b.level || a.order - b.order,
    ),
    challenges: parseAll(files.challenges, (r) => Challenge.safeParse(r)).sort(
      (a, b) => a.number - b.number,
    ),
    glossary: parseAll(files.glossary, (r) => Glossary.safeParse(r))
      .flatMap((g) => g.terms)
      .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' })),
    theories: parseAll(files.theories, (r) => Theories.safeParse(r)).flatMap((t) => t.theories),
    citations: parseAll(files.citations, (r) => Citations.safeParse(r)).flatMap((c) => c.citations),
  };
}

export const FIXTURE_FLAG = 'sem-studio:learn-fixtures';

export const useContent = create<ContentSet>()(() => loadContent());

if (import.meta.env.DEV && typeof window !== 'undefined') {
  try {
    if (window.localStorage.getItem(FIXTURE_FLAG) === '1')
      void import('./__fixtures__/content').then((m) => useContent.setState(m.fixtureContent));
  } catch {
    /* storage unavailable: real content stays */
  }
}

export interface ResolvedCitation {
  key: string;
  text: string;
  doi?: string | undefined;
  url?: string | undefined;
  known: boolean;
}

function citationMap(extra: readonly Citation[]): Map<string, Omit<ResolvedCitation, 'known'>> {
  const byKey = new Map<string, Omit<ResolvedCitation, 'known'>>();
  for (const c of registry.citations) byKey.set(c.key, c);
  for (const c of extra) byKey.set(c.key, c);
  return byKey;
}

/** Citation text by key, from the method registry and the content citations. */
export function resolveCitations(
  keys: readonly string[],
  extra: readonly Citation[],
): ResolvedCitation[] {
  const byKey = citationMap(extra);
  return keys.map((k) => {
    const c = byKey.get(k);
    return c ? { ...c, known: true } : { key: k, text: k, known: false };
  });
}

export function allCitations(extra: readonly Citation[]): ResolvedCitation[] {
  return [...citationMap(extra).values()]
    .map((c) => ({ ...c, known: true }))
    .sort((a, b) => a.text.localeCompare(b.text));
}
