import { ChevronRight, Target, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { IconButton } from '@/components/ui';
import { useActiveChallenge } from './active';
import { ChallengeTasks } from './ChallengeTasks';
import { useContent } from './content';
import { summarizeChallenge, useLoadProgress, useProgress } from './progress';

/**
 * The active challenge, docked beside the page the student is working on (Modeler, Data,
 * Analysis, Results). Collapsed it is a 44px rail with a button; expanded it is a 360px region
 * with the tasks, Check buttons and hints. No second editor: Check reads the real project.
 */
export default function ChallengeDock() {
  const { challengeId, open, setOpen, stop } = useActiveChallenge();
  const challenge = useContent((c) => c.challenges.find((x) => x.id === challengeId));
  const progress = useProgress((s) => (challengeId ? s.challenges[challengeId] : undefined));
  useLoadProgress();
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef(true);

  // Return focus to the rail button after the panel is collapsed from the keyboard.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!open) toggle.current?.focus();
  }, [open]);

  if (!challengeId) return null;
  const sum = challenge ? summarizeChallenge(challenge, progress) : null;
  const title = challenge?.title ?? 'Challenge';

  if (!open)
    return (
      <aside className="dock dock--rail" aria-label="Active challenge">
        <button
          ref={toggle}
          type="button"
          className="dock__rail-btn"
          aria-expanded={false}
          aria-label={`Open active challenge: ${title}`}
          onClick={() => setOpen(true)}
        >
          <Target size={18} aria-hidden="true" />
          {sum ? (
            <span className="dock__rail-count" aria-hidden="true">
              {sum.solved}/{sum.total}
            </span>
          ) : null}
        </button>
      </aside>
    );

  return (
    // The Escape handler collapses the panel; focus stays on the controls inside it.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <aside
      className="dock"
      aria-label="Active challenge"
      id="challenge-dock-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className="dock__head">
        <Target size={16} aria-hidden="true" />
        <h2 className="dock__title">{title}</h2>
        <IconButton
          aria-label="Collapse challenge panel"
          size="small"
          onClick={() => setOpen(false)}
        >
          <ChevronRight size={16} />
        </IconButton>
        <IconButton aria-label="Stop challenge" size="small" onClick={stop}>
          <X size={16} />
        </IconButton>
      </div>
      {challenge && sum ? (
        <div className="dock__body">
          <p className="dock__progress">
            {sum.solved} of {sum.total} tasks solved ·{' '}
            <Link to={`/challenges/${challenge.id}`}>Brief and solution</Link>
          </p>
          <ChallengeTasks challenge={challenge} compact />
        </div>
      ) : (
        <div className="dock__body">
          <p className="ch-muted">This challenge is not available in this build.</p>
        </div>
      )}
    </aside>
  );
}
