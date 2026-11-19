/**
 * In-memory working state of the challenge the student is on: typed answers, the latest
 * feedback per task and the self-assessment ticks. Solved tasks and attempts are persisted by
 * the progress store; this store only keeps what is on screen, so the Challenges page and the
 * docked panel always agree.
 */
import { create } from 'zustand';
import { currentContext } from './context';
import { type TaskAnswer, type TaskResult, evaluateTask } from './evaluate';
import { useProgress } from './progress';
import type { Challenge, Task } from './schema';

interface WorkspaceState {
  answers: Record<string, TaskAnswer>;
  results: Record<string, TaskResult>;
  setAnswer: (challengeId: string, taskId: string, answer: TaskAnswer) => void;
  /** Evaluate one task against the typed answer or the app's current state and record it. */
  check: (challenge: Challenge, task: Task) => Promise<TaskResult>;
}

const k = (c: string, t: string): string => `${c}/${t}`;

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  answers: {},
  results: {},
  setAnswer: (c, t, answer) => set((s) => ({ answers: { ...s.answers, [k(c, t)]: answer } })),
  async check(challenge, task) {
    const result = evaluateTask(
      task,
      get().answers[k(challenge.id, task.id)] ?? {},
      currentContext(),
    );
    set((s) => ({ results: { ...s.results, [k(challenge.id, task.id)]: result } }));
    if (result.answered)
      await useProgress.getState().recordTask(challenge, task.id, result.correct);
    return result;
  },
}));

export const taskKey = k;
