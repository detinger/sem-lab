/**
 * Local learning progress (PLAN §2.11/§2.12): lesson checks, challenge attempts and achieved
 * skills, in this browser's IndexedDB. Nothing leaves the device; "Reset progress" in Settings
 * clears all three tables. Types live here so the Dexie schema and the store share them.
 */
import { getDb } from './projects';

export interface CheckRecord {
  /** answered correctly at least once (never un-set by a later wrong try) */
  correct: boolean;
  attempts: number;
  lastAnsweredAt: string;
}

export interface LessonProgress {
  lessonId: string;
  checks: Record<string, CheckRecord>;
  /** set when every knowledge check has been answered correctly once */
  completedAt?: string;
}

export interface TaskRecord {
  /** best result: true once the task has been solved, retries cannot take it away */
  correct: boolean;
  attempts: number;
  /** hints that were open when the task was first solved */
  hintsAtSolve?: number;
  solvedAt?: string;
  lastAttemptAt: string;
}

export interface ChallengeProgress {
  challengeId: string;
  startedAt: string;
  updatedAt: string;
  tasks: Record<string, TaskRecord>;
  hintsUsed: number;
  solutionShown: boolean;
  completedAt?: string;
}

export interface SkillRecord {
  skill: string;
  achievedAt: string;
  challengeId: string;
}

export const listLessonProgress = (): Promise<LessonProgress[]> => getDb().lessonProgress.toArray();
export const saveLessonProgress = (p: LessonProgress): Promise<unknown> =>
  getDb().lessonProgress.put(p);
export const listChallengeProgress = (): Promise<ChallengeProgress[]> =>
  getDb().challengeProgress.toArray();
export const saveChallengeProgress = (p: ChallengeProgress): Promise<unknown> =>
  getDb().challengeProgress.put(p);
export const listSkills = (): Promise<SkillRecord[]> => getDb().skills.toArray();
export const saveSkills = (s: SkillRecord[]): Promise<unknown> => getDb().skills.bulkPut(s);

/** Remove every learning record (projects and datasets are untouched). */
export async function clearLearningProgress(): Promise<void> {
  const db = getDb();
  await Promise.all([db.lessonProgress.clear(), db.challengeProgress.clear(), db.skills.clear()]);
}
