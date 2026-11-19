/**
 * A pool of draw workers behind the engine's `executeDraws` hook. The estimate worker owns the
 * sequential index stream; this pool only fits the draws it is handed, in small tasks that idle
 * workers pick up, and returns them in draw order whatever order the tasks finish in. Results
 * therefore equal a single-threaded run exactly.
 */
import { type BootstrapProblem, type DrawResult, EngineError, fitDraw } from '@sem-lab/engine';
import type { FromDrawWorker, ToDrawWorker } from './protocol';

/** Minimal worker surface (a real Worker is adapted; tests use an in-process fake). */
export interface PoolWorker {
  post(m: ToDrawWorker): void;
  terminate(): void;
  onMessage(cb: (m: FromDrawWorker) => void): void;
  onError(cb: () => void): void;
}

interface Slot {
  w: PoolWorker;
  problemId: number;
  busy: number | null; // taskId
  dead: boolean;
}
interface Task {
  id: number;
  offset: number;
  indices: Int32Array[];
}
interface Job {
  problem: BootstrapProblem;
  problemId: number;
  results: DrawResult[];
  remaining: number;
  queue: Task[];
  resolve: (r: DrawResult[]) => void;
  reject: (e: unknown) => void;
}

export class DrawPool {
  private slots: Slot[] = [];
  private job: Job | null = null;
  private inflight = new Map<number, { task: Task; slot: Slot }>();
  private nextTask = 1;
  private problem: BootstrapProblem | null = null;
  private problemId = 0;
  private stopped = false;

  constructor(factory: () => PoolWorker, size: number) {
    for (let i = 0; i < size; i++) {
      let w: PoolWorker;
      try {
        w = factory();
      } catch {
        continue;
      }
      const slot: Slot = { w, problemId: -1, busy: null, dead: false };
      w.onMessage((m) => this.onMessage(slot, m));
      w.onError(() => this.onDead(slot));
      this.slots.push(slot);
    }
  }

  get size(): number {
    return this.slots.filter((s) => !s.dead).length;
  }

  readonly executeDraws = (
    problem: BootstrapProblem,
    batch: Int32Array[],
  ): Promise<DrawResult[]> => {
    if (this.stopped) return Promise.reject(new EngineError('CANCELLED', 'The job was cancelled.'));
    if (problem !== this.problem) {
      this.problem = problem;
      this.problemId++;
    }
    const live = Math.max(1, this.size);
    const chunk = Math.max(1, Math.ceil(batch.length / (live * 3)));
    const queue: Task[] = [];
    for (let o = 0; o < batch.length; o += chunk)
      queue.push({ id: this.nextTask++, offset: o, indices: batch.slice(o, o + chunk) });
    return new Promise<DrawResult[]>((resolve, reject) => {
      this.job = {
        problem,
        problemId: this.problemId,
        results: new Array<DrawResult>(batch.length),
        remaining: batch.length,
        queue,
        resolve,
        reject,
      };
      this.pump();
    });
  };

  terminate(): void {
    this.stopped = true;
    for (const s of this.slots) {
      s.dead = true;
      s.w.terminate();
    }
    const job = this.job;
    this.job = null;
    job?.reject(new EngineError('CANCELLED', 'The job was cancelled during bootstrapping.'));
  }

  private pump(): void {
    const job = this.job;
    if (!job) return;
    for (const slot of this.slots) {
      if (slot.dead || slot.busy !== null) continue;
      const task = job.queue.shift();
      if (!task) break;
      if (slot.problemId !== job.problemId) {
        slot.w.post({ type: 'problem', problemId: job.problemId, problem: job.problem });
        slot.problemId = job.problemId;
      }
      slot.busy = task.id;
      this.inflight.set(task.id, { task, slot });
      slot.w.post({
        type: 'task',
        taskId: task.id,
        problemId: job.problemId,
        indices: task.indices,
      });
    }
    // no live worker left: finish in-process (same function, same results)
    if (this.size === 0) {
      while (job.queue.length > 0) {
        const t = job.queue.shift()!;
        this.finish(
          job,
          t,
          t.indices.map((i) => fitDraw(job.problem, i)),
        );
      }
    }
  }

  private finish(job: Job, task: Task, results: DrawResult[]): void {
    results.forEach((r, i) => (job.results[task.offset + i] = r));
    job.remaining -= results.length;
    if (job.remaining === 0 && this.job === job) {
      this.job = null;
      job.resolve(job.results);
    }
  }

  private onMessage(slot: Slot, m: FromDrawWorker): void {
    const entry = this.inflight.get(m.taskId);
    const job = this.job;
    if (!entry || !job) return;
    this.inflight.delete(m.taskId);
    slot.busy = null;
    if (m.type === 'error') {
      this.onDead(slot, entry.task);
      return;
    }
    this.finish(job, entry.task, m.results);
    this.pump();
  }

  private onDead(slot: Slot, task?: Task): void {
    if (slot.dead && !task) return;
    slot.dead = true;
    slot.w.terminate();
    const lost = task ?? (slot.busy !== null ? this.inflight.get(slot.busy)?.task : undefined);
    if (slot.busy !== null) this.inflight.delete(slot.busy);
    slot.busy = null;
    if (lost && this.job) this.job.queue.unshift(lost);
    this.pump();
  }
}
