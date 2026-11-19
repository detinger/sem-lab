import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { DB_NAME, resetDbForTests } from '@/storage/projects';
import { listChallengeProgress, listLessonProgress, listSkills } from '@/storage/learn';
import {
  isLessonComplete,
  progressTotals,
  recordCheck,
  recordHint,
  recordSolution,
  recordTaskAttempt,
  summarizeChallenge,
  useProgress,
} from './progress';
import { fixtureContent } from './__fixtures__/content';

const lesson = fixtureContent.lessons[0]!;
const challenge = fixtureContent.challenges.find((c) => c.tasks.length > 1)!;

describe('lesson progress', () => {
  it('completes only when every check was answered correctly once', () => {
    const two = { id: lesson.id, checks: [{ id: 'a' }, { id: 'b' }] } as never;
    let p = recordCheck(undefined, two, 'a', true, 't1');
    expect(isLessonComplete(p)).toBe(false);
    p = recordCheck(p, two, 'b', false, 't2');
    expect(isLessonComplete(p)).toBe(false);
    p = recordCheck(p, two, 'b', true, 't3');
    expect(isLessonComplete(p)).toBe(true);
    expect(p.completedAt).toBe('t3');
    expect(p.checks.b).toMatchObject({ correct: true, attempts: 2 });
    // a later wrong answer never undoes completion
    p = recordCheck(p, two, 'a', false, 't4');
    expect(p.checks.a?.correct).toBe(true);
    expect(p.completedAt).toBe('t3');
  });
});

describe('challenge progress', () => {
  it('keeps the best result, counts attempts and records hints at the time of solving', () => {
    const c = {
      id: 'c1',
      tasks: [
        { id: 't1', dimension: 'structure' },
        { id: 't2', dimension: 'numeric' },
      ],
    } as never;
    let p = recordTaskAttempt(undefined, c, 't1', false, 'a');
    p = recordHint(p, c, 2, 'b');
    p = recordTaskAttempt(p, c, 't1', true, 'c');
    expect(p.tasks.t1).toMatchObject({
      correct: true,
      attempts: 2,
      hintsAtSolve: 2,
      solvedAt: 'c',
    });
    p = recordTaskAttempt(p, c, 't1', false, 'd');
    expect(p.tasks.t1).toMatchObject({
      correct: true,
      attempts: 3,
      solvedAt: 'c',
      hintsAtSolve: 2,
    });
    expect(p.completedAt).toBeUndefined();
    p = recordTaskAttempt(p, c, 't2', true, 'e');
    expect(p.completedAt).toBe('e');
    expect(recordHint(p, c, 1).hintsUsed).toBe(2); // hint count never goes down
    expect(recordSolution(p, c).solutionShown).toBe(true);
  });
  it('scores per dimension', () => {
    const c = {
      tasks: [
        { id: 'a', dimension: 'structure' },
        { id: 'b', dimension: 'structure' },
        { id: 'c', dimension: 'numeric' },
      ],
    } as never;
    const p = recordTaskAttempt(undefined, { id: 'x', ...(c as object) } as never, 'a', true);
    const s = summarizeChallenge(c, p);
    expect(s).toMatchObject({ solved: 1, total: 3, complete: false });
    expect(s.dimensions).toEqual({
      structure: { solved: 1, total: 2 },
      numeric: { solved: 0, total: 1 },
    });
    expect(s.score).toBeCloseTo(1 / 3, 12);
  });
});

describe('progress store (IndexedDB)', () => {
  beforeEach(async () => {
    resetDbForTests();
    await Dexie.delete(DB_NAME);
    useProgress.setState({ loaded: false, lessons: {}, challenges: {}, skills: {} });
  });

  it('persists, reloads and resets; completing a challenge achieves its skills', async () => {
    const s = useProgress.getState();
    for (const q of lesson.checks) await s.answerCheck(lesson, q.id, true);
    for (const t of challenge.tasks) await useProgress.getState().recordTask(challenge, t.id, true);
    expect((await listLessonProgress())[0]?.completedAt).toBeDefined();
    expect((await listChallengeProgress())[0]?.completedAt).toBeDefined();
    expect((await listSkills()).map((x) => x.skill).sort()).toEqual([...challenge.skills].sort());

    useProgress.setState({ loaded: false, lessons: {}, challenges: {}, skills: {} });
    await useProgress.getState().load();
    const st = useProgress.getState();
    expect(st.loaded).toBe(true);
    expect(isLessonComplete(st.lessons[lesson.id])).toBe(true);
    expect(progressTotals(fixtureContent.lessons, fixtureContent.challenges, st)).toMatchObject({
      lessonsDone: 1,
      challengesDone: 1,
      skills: challenge.skills.length,
    });

    await st.reset();
    expect(await listLessonProgress()).toEqual([]);
    expect(await listChallengeProgress()).toEqual([]);
    expect(await listSkills()).toEqual([]);
    expect(useProgress.getState().lessons).toEqual({});
  });
});

describe('load() racing with an answer', () => {
  it('keeps an answer recorded while the database read was in flight', async () => {
    const { useProgress } = await import('./progress');
    useProgress.setState({ loaded: false, lessons: {}, challenges: {}, skills: {} });
    const loading = useProgress.getState().load(); // the read starts first …
    useProgress.setState((st) => ({
      lessons: {
        ...st.lessons,
        'race-lesson': { lessonId: 'race-lesson', checks: {}, updatedAt: 'now' } as never,
      },
    })); // … an answer lands before it resolves
    await loading;
    expect(useProgress.getState().lessons['race-lesson']).toBeDefined();
  });
});
