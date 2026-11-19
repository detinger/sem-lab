/**
 * Learning progress: pure reducers over the stored records (tested in progress.test.ts) and a
 * small zustand store that writes them through to IndexedDB. Exploration is never punished:
 * a solved task stays solved, hints and retries are recorded but do not lower anything.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import {
  type ChallengeProgress,
  type LessonProgress,
  type SkillRecord,
  clearLearningProgress,
  listChallengeProgress,
  listLessonProgress,
  listSkills,
  saveChallengeProgress,
  saveLessonProgress,
  saveSkills,
} from '@/storage/learn';
import type { Challenge, Dimension, Lesson } from './schema';

const now = (): string => new Date().toISOString();

// ---- lessons ----------------------------------------------------------------------------------

export function recordCheck(
  prev: LessonProgress | undefined,
  lesson: Pick<Lesson, 'id' | 'checks'>,
  checkId: string,
  correct: boolean,
  at: string = now(),
): LessonProgress {
  const base: LessonProgress = prev ?? { lessonId: lesson.id, checks: {} };
  const old = base.checks[checkId];
  const checks = {
    ...base.checks,
    [checkId]: {
      correct: (old?.correct ?? false) || correct,
      attempts: (old?.attempts ?? 0) + 1,
      lastAnsweredAt: at,
    },
  };
  const done = lesson.checks.every((c) => checks[c.id]?.correct);
  return {
    ...base,
    checks,
    ...(done ? { completedAt: base.completedAt ?? at } : {}),
  };
}

export const isLessonComplete = (p: LessonProgress | undefined): boolean =>
  p?.completedAt !== undefined;

// ---- challenges -------------------------------------------------------------------------------

export function recordTaskAttempt(
  prev: ChallengeProgress | undefined,
  challenge: Pick<Challenge, 'id' | 'tasks'>,
  taskId: string,
  correct: boolean,
  at: string = now(),
): ChallengeProgress {
  const base: ChallengeProgress = prev ?? {
    challengeId: challenge.id,
    startedAt: at,
    updatedAt: at,
    tasks: {},
    hintsUsed: 0,
    solutionShown: false,
  };
  const old = base.tasks[taskId];
  const solvedNow = correct && !old?.correct;
  const tasks = {
    ...base.tasks,
    [taskId]: {
      correct: (old?.correct ?? false) || correct,
      attempts: (old?.attempts ?? 0) + 1,
      lastAttemptAt: at,
      ...(old?.solvedAt
        ? {
            solvedAt: old.solvedAt,
            ...(old.hintsAtSolve !== undefined ? { hintsAtSolve: old.hintsAtSolve } : {}),
          }
        : solvedNow
          ? { solvedAt: at, hintsAtSolve: base.hintsUsed }
          : {}),
    },
  };
  const done = challenge.tasks.every((t) => tasks[t.id]?.correct);
  return {
    ...base,
    tasks,
    updatedAt: at,
    ...(done ? { completedAt: base.completedAt ?? at } : {}),
  };
}

export function recordHint(
  prev: ChallengeProgress | undefined,
  challenge: Pick<Challenge, 'id'>,
  count: number,
  at: string = now(),
): ChallengeProgress {
  const base: ChallengeProgress = prev ?? {
    challengeId: challenge.id,
    startedAt: at,
    updatedAt: at,
    tasks: {},
    hintsUsed: 0,
    solutionShown: false,
  };
  return { ...base, hintsUsed: Math.max(base.hintsUsed, count), updatedAt: at };
}

export function recordSolution(
  prev: ChallengeProgress | undefined,
  challenge: Pick<Challenge, 'id'>,
  at: string = now(),
): ChallengeProgress {
  const base = prev ?? recordHint(undefined, challenge, 0, at);
  return { ...base, solutionShown: true, updatedAt: at };
}

export interface ChallengeSummary {
  solved: number;
  total: number;
  complete: boolean;
  /** 0–1 share of tasks solved */
  score: number;
  /** per assessment dimension that the challenge covers: solved / total tasks in it */
  dimensions: Partial<Record<Dimension, { solved: number; total: number }>>;
}

export function summarizeChallenge(
  challenge: Pick<Challenge, 'tasks'>,
  p: ChallengeProgress | undefined,
): ChallengeSummary {
  const dimensions: ChallengeSummary['dimensions'] = {};
  let solved = 0;
  for (const t of challenge.tasks) {
    const d = (dimensions[t.dimension] ??= { solved: 0, total: 0 });
    d.total++;
    if (p?.tasks[t.id]?.correct) {
      d.solved++;
      solved++;
    }
  }
  const total = challenge.tasks.length;
  return {
    solved,
    total,
    complete: total > 0 && solved === total,
    score: total ? solved / total : 0,
    dimensions,
  };
}

// ---- store ------------------------------------------------------------------------------------

interface ProgressState {
  loaded: boolean;
  lessons: Record<string, LessonProgress>;
  challenges: Record<string, ChallengeProgress>;
  skills: Record<string, SkillRecord>;
  load: () => Promise<void>;
  answerCheck: (lesson: Lesson, checkId: string, correct: boolean) => Promise<void>;
  recordTask: (challenge: Challenge, taskId: string, correct: boolean) => Promise<void>;
  recordHints: (challenge: Challenge, count: number) => Promise<void>;
  showSolution: (challenge: Challenge) => Promise<void>;
  reset: () => Promise<void>;
}

const byKey = <T>(rows: T[], key: (r: T) => string): Record<string, T> =>
  Object.fromEntries(rows.map((r) => [key(r), r]));

/** Persistence failures never block learning: the in-memory state stays authoritative. */
const quiet = (p: Promise<unknown>): Promise<void> =>
  p.then(
    () => undefined,
    () => undefined,
  );

export const useProgress = create<ProgressState>()((set, get) => ({
  loaded: false,
  lessons: {},
  challenges: {},
  skills: {},
  async load() {
    try {
      const [l, c, s] = await Promise.all([
        listLessonProgress(),
        listChallengeProgress(),
        listSkills(),
      ]);
      // Merge, in-memory entries winning: anything recorded while the read was in flight (an
      // answer given right after the page mounted) is newer than what the database returned.
      set((st) => ({
        loaded: true,
        lessons: { ...byKey(l, (r) => r.lessonId), ...st.lessons },
        challenges: { ...byKey(c, (r) => r.challengeId), ...st.challenges },
        skills: { ...byKey(s, (r) => r.skill), ...st.skills },
      }));
    } catch {
      set({ loaded: true });
    }
  },
  async answerCheck(lesson, checkId, correct) {
    const next = recordCheck(get().lessons[lesson.id], lesson, checkId, correct);
    set((st) => ({ lessons: { ...st.lessons, [lesson.id]: next } }));
    await quiet(saveLessonProgress(next));
  },
  async recordTask(challenge, taskId, correct) {
    const next = recordTaskAttempt(get().challenges[challenge.id], challenge, taskId, correct);
    const fresh: SkillRecord[] =
      next.completedAt && !get().challenges[challenge.id]?.completedAt
        ? challenge.skills
            .filter((s) => !get().skills[s])
            .map((skill) => ({
              skill,
              achievedAt: next.completedAt ?? now(),
              challengeId: challenge.id,
            }))
        : [];
    set((st) => ({
      challenges: { ...st.challenges, [challenge.id]: next },
      skills: { ...st.skills, ...byKey(fresh, (r) => r.skill) },
    }));
    await quiet(saveChallengeProgress(next));
    if (fresh.length > 0) await quiet(saveSkills(fresh));
  },
  async recordHints(challenge, count) {
    const next = recordHint(get().challenges[challenge.id], challenge, count);
    set((st) => ({ challenges: { ...st.challenges, [challenge.id]: next } }));
    await quiet(saveChallengeProgress(next));
  },
  async showSolution(challenge) {
    const next = recordSolution(get().challenges[challenge.id], challenge);
    set((st) => ({ challenges: { ...st.challenges, [challenge.id]: next } }));
    await quiet(saveChallengeProgress(next));
  },
  async reset() {
    set({ lessons: {}, challenges: {}, skills: {} });
    await clearLearningProgress();
  },
}));

/** Totals for the Overview card. */
export function progressTotals(
  lessons: readonly Pick<Lesson, 'id'>[],
  challenges: readonly Pick<Challenge, 'id'>[],
  s: Pick<ProgressState, 'lessons' | 'challenges' | 'skills'>,
): {
  lessonsDone: number;
  lessonsTotal: number;
  challengesDone: number;
  challengesTotal: number;
  skills: number;
} {
  return {
    lessonsDone: lessons.filter((l) => isLessonComplete(s.lessons[l.id])).length,
    lessonsTotal: lessons.length,
    challengesDone: challenges.filter((c) => s.challenges[c.id]?.completedAt !== undefined).length,
    challengesTotal: challenges.length,
    skills: Object.keys(s.skills).length,
  };
}

/** Load stored progress once (idempotent); returns the store's `loaded` flag. */
export function useLoadProgress(): boolean {
  const loaded = useProgress((s) => s.loaded);
  const load = useProgress((s) => s.load);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return loaded;
}
