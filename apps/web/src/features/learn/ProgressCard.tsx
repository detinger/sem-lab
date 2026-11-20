import { GraduationCap, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, CardHeader, Dialog, ProgressBar, useToast } from '@/components/ui';
import { useContent } from './content';
import { progressTotals, useLoadProgress, useProgress } from './progress';

/** "Learning progress" card for the Overview page. Reads local progress only. */
export function ProgressCard() {
  useLoadProgress();
  const lessons = useContent((c) => c.lessons);
  const challenges = useContent((c) => c.challenges);
  const lp = useProgress((s) => s.lessons);
  const cp = useProgress((s) => s.challenges);
  const sk = useProgress((s) => s.skills);
  const t = progressTotals(lessons, challenges, { lessons: lp, challenges: cp, skills: sk });
  const none = t.lessonsTotal === 0 && t.challengesTotal === 0;
  const reset = useProgress((s) => s.reset);
  const { toast } = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  // Attempts and hints count too, not only completions.
  const hasProgress = Object.keys(lp).length + Object.keys(cp).length + Object.keys(sk).length > 0;
  return (
    <Card>
      <CardHeader
        title="Learning progress"
        level={3}
        icon={<GraduationCap size={18} />}
        action={
          hasProgress ? (
            <Button
              size="small"
              variant="ghost"
              icon={<RotateCcw />}
              onClick={() => setConfirmReset(true)}
            >
              Reset progress
            </Button>
          ) : null
        }
      />
      {none ? (
        <p className="text-muted">
          Lessons and challenges will show your progress here. Everything stays in this browser.
        </p>
      ) : (
        <div className="progress-card">
          <ProgressBar
            label={`Lessons: ${t.lessonsDone} of ${t.lessonsTotal} completed`}
            value={t.lessonsDone}
            max={Math.max(t.lessonsTotal, 1)}
            showValue={false}
          />
          <ProgressBar
            label={`Challenges: ${t.challengesDone} of ${t.challengesTotal} completed`}
            value={t.challengesDone}
            max={Math.max(t.challengesTotal, 1)}
            showValue={false}
          />
          <p className="text-muted">
            Skills achieved: {t.skills}. <Link to="/learn">Open lessons</Link> ·{' '}
            <Link to="/challenges">Open challenges</Link>
          </p>
        </div>
      )}
      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset learning progress?"
        description="This removes your completed lessons, challenge attempts, hints used and achieved skills from this browser. It cannot be undone. Projects and data are not affected."
        width={480}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmReset(false);
                void reset().then(() => toast({ variant: 'success', title: 'Progress reset' }));
              }}
            >
              Reset progress
            </Button>
          </>
        }
      />
    </Card>
  );
}
