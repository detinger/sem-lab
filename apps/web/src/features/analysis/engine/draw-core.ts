/** The draw worker's logic, free of any worker global so tests can run it in-process. */
import { type BootstrapProblem, fitDraw } from '@sem-lab/engine';
import type { FromDrawWorker, ToDrawWorker } from './protocol';

export function createDrawHandler(reply: (m: FromDrawWorker) => void): (m: ToDrawWorker) => void {
  const problems = new Map<number, BootstrapProblem>();
  return (m) => {
    if (m.type === 'problem') {
      problems.clear();
      problems.set(m.problemId, m.problem);
      return;
    }
    const problem = problems.get(m.problemId);
    if (!problem) {
      reply({ type: 'error', taskId: m.taskId, message: 'unknown problem' });
      return;
    }
    try {
      reply({
        type: 'result',
        taskId: m.taskId,
        results: m.indices.map((idx) => fitDraw(problem, idx)),
      });
    } catch {
      reply({ type: 'error', taskId: m.taskId, message: 'draw failed' });
    }
  };
}
