import { CircleAlert, CircleCheck, CircleMinus, CircleX, Info, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Callout } from '@/components/ui';
import { Blocks } from './Blocks';
import { type Finding, type FindingStatus, isWorkspaceTask } from './evaluate';
import { InlineText } from './inline';
import { useProgress } from './progress';
import type { Challenge, Task } from './schema';
import { taskKey, useWorkspace } from './workspace';

const FINDING: Record<FindingStatus, { Icon: typeof Info; label: string }> = {
  ok: { Icon: CircleCheck, label: 'Correct' },
  missing: { Icon: CircleAlert, label: 'Missing' },
  wrong: { Icon: CircleX, label: 'Not right' },
  extra: { Icon: CircleMinus, label: 'Extra' },
  note: { Icon: Info, label: 'Note' },
};

export function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="ch-findings">
      {findings.map((f, i) => {
        const { Icon, label } = FINDING[f.status];
        return (
          <li key={i} className={`ch-finding ch-finding--${f.status}`}>
            <Icon size={16} aria-hidden="true" />
            <span>
              <span className="sr-only">{label}: </span>
              <InlineText text={f.text} noTerms />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TaskInput({ challenge, task }: { challenge: Challenge; task: Task }) {
  const key = taskKey(challenge.id, task.id);
  const answer = useWorkspace((s) => s.answers[key]) ?? {};
  const setAnswer = useWorkspace((s) => s.setAnswer);
  const set = (a: typeof answer) => setAnswer(challenge.id, task.id, a);
  if (task.kind === 'choice') {
    const chosen = answer.choice ?? [];
    const type = task.multiple ? 'checkbox' : 'radio';
    return (
      <fieldset className="ch-options">
        <legend className="sr-only">{task.prompt}</legend>
        {task.options.map((o) => (
          <label key={o.id} className="ch-option">
            <input
              type={type}
              name={`${key}-opt`}
              checked={chosen.includes(o.id)}
              onChange={(e) =>
                set({
                  choice: task.multiple
                    ? e.target.checked
                      ? [...chosen, o.id]
                      : chosen.filter((x) => x !== o.id)
                    : [o.id],
                })
              }
            />
            <span>
              <InlineText text={o.text} noTerms />
            </span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (task.kind === 'number') {
    return (
      <div className="ch-number">
        <input
          className="ui-control"
          inputMode="decimal"
          aria-label={`Answer${task.unit ? ` in ${task.unit}` : ''}`}
          value={answer.number ?? ''}
          onChange={(e) => set({ number: e.target.value })}
        />
        {task.unit ? <span className="ch-muted">{task.unit}</span> : null}
      </div>
    );
  }
  if (task.kind === 'self-assess') {
    const ticks = answer.ticks ?? [];
    return (
      <div className="ch-options">
        {task.checklist.map((item, i) => (
          <label key={i} className="ch-option">
            <input
              type="checkbox"
              checked={ticks[i] === true}
              onChange={(e) =>
                set({
                  ticks: task.checklist.map((_, j) =>
                    j === i ? e.target.checked : ticks[j] === true,
                  ),
                })
              }
            />
            <span>
              <InlineText text={item} noTerms />
            </span>
          </label>
        ))}
      </div>
    );
  }
  const where =
    task.kind === 'model'
      ? 'the Modeler'
      : task.kind === 'mapping'
        ? 'the Data page'
        : 'the Analysis page';
  return (
    <p className="ch-muted">
      Work in {where}; this task is checked against your current project when you press Check.
    </p>
  );
}

function TaskCard({ challenge, task, index }: { challenge: Challenge; task: Task; index: number }) {
  const key = taskKey(challenge.id, task.id);
  const result = useWorkspace((s) => s.results[key]);
  const check = useWorkspace((s) => s.check);
  const record = useProgress((s) => s.challenges[challenge.id]?.tasks[task.id]);
  const [busy, setBusy] = useState(false);
  return (
    <li className="ch-task" aria-label={`Task ${index + 1}`}>
      <div className="ch-task__head">
        <span className="ch-task__n">{index + 1}</span>
        <p className="ch-task__prompt">
          <InlineText text={task.prompt} />
        </p>
        {record?.correct ? (
          <Badge variant="success">Solved</Badge>
        ) : isWorkspaceTask(task) ? (
          <Badge variant="neutral">Checked in app</Badge>
        ) : null}
      </div>
      <TaskInput challenge={challenge} task={task} />
      <div className="ch-task__actions">
        <Button
          size="small"
          variant="primary"
          disabled={busy}
          aria-label={`Check task ${index + 1}`}
          onClick={() => {
            setBusy(true);
            void check(challenge, task).finally(() => setBusy(false));
          }}
        >
          Check
        </Button>
        {record ? <span className="ch-muted">Attempts: {record.attempts}</span> : null}
      </div>
      {result ? (
        <div role="status" aria-live="polite" className="ch-result">
          <p className="ch-result__head">
            {result.correct
              ? 'Correct'
              : result.answered
                ? 'Not there yet'
                : 'Nothing to check yet'}
          </p>
          <FindingList findings={result.findings} />
        </div>
      ) : null}
    </li>
  );
}

/** Progressive hints, one at a time. Using a hint is recorded but never penalised. */
export function Hints({ challenge }: { challenge: Challenge }) {
  const saved = useProgress((s) => s.challenges[challenge.id]?.hintsUsed ?? 0);
  const recordHints = useProgress((s) => s.recordHints);
  const [shown, setShown] = useState(0);
  const count = Math.min(Math.max(shown, saved), challenge.hints.length);
  return (
    <section className="ch-hints" aria-label="Hints">
      <h4 className="ch-sub">
        <Lightbulb size={14} aria-hidden="true" /> Hints ({count} of {challenge.hints.length} used)
      </h4>
      {count > 0 ? (
        <ol className="ch-hint-list">
          {challenge.hints.slice(0, count).map((h, i) => (
            <li key={i}>
              <InlineText text={h} />
            </li>
          ))}
        </ol>
      ) : null}
      <Button
        size="small"
        disabled={count >= challenge.hints.length}
        onClick={() => {
          setShown(count + 1);
          void recordHints(challenge, count + 1);
        }}
      >
        {count === 0
          ? 'Show a hint'
          : count >= challenge.hints.length
            ? 'No more hints'
            : 'Show the next hint'}
      </Button>
    </section>
  );
}

export function SolutionSection({ challenge }: { challenge: Challenge }) {
  const progress = useProgress((s) => s.challenges[challenge.id]);
  const showSolution = useProgress((s) => s.showSolution);
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(false);
  const attempted = Object.values(progress?.tasks ?? {}).some((t) => t.attempts > 0);
  const visible = open || progress?.solutionShown === true;
  return (
    <section className="ch-solution" aria-label="Solution">
      {visible ? (
        <>
          <h3>Solution</h3>
          <Blocks blocks={challenge.solution} />
        </>
      ) : confirm ? (
        <Callout variant="info" title="Show the solution without a check first?">
          <p>
            Trying first is the better way to learn, but it is your choice. Nothing is lost either
            way.
          </p>
          <div className="ch-task__actions">
            <Button
              variant="primary"
              size="small"
              onClick={() => {
                setOpen(true);
                void showSolution(challenge);
              }}
            >
              Yes, show the solution
            </Button>
            <Button size="small" onClick={() => setConfirm(false)}>
              Keep trying
            </Button>
          </div>
        </Callout>
      ) : (
        <Button
          onClick={() => {
            if (attempted) {
              setOpen(true);
              void showSolution(challenge);
            } else setConfirm(true);
          }}
        >
          Show solution
        </Button>
      )}
    </section>
  );
}

/** Tasks + hints, shared by the Challenge page and the docked panel. */
export function ChallengeTasks({
  challenge,
  compact = false,
}: {
  challenge: Challenge;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'ch-tasks ch-tasks--compact' : 'ch-tasks'}>
      <ol className="ch-task-list">
        {challenge.tasks.map((t, i) => (
          <TaskCard key={t.id} challenge={challenge} task={t} index={i} />
        ))}
      </ol>
      <Hints challenge={challenge} />
    </div>
  );
}
