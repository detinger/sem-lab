import { GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, ProgressBar } from '@/components/ui';
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
  return (
    <Card>
      <CardHeader title="Learning progress" level={3} icon={<GraduationCap size={18} />} />
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
    </Card>
  );
}
