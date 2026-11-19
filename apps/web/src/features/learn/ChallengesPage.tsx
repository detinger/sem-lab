import { ArrowLeft, ArrowRight, Play, Square, Target } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { useActiveChallenge } from './active';
import { Blocks } from './Blocks';
import { ChallengeTasks, SolutionSection } from './ChallengeTasks';
import { useContent } from './content';
import { isWorkspaceTask } from './evaluate';
import { InlineText } from './inline';
import { summarizeChallenge, useLoadProgress, useProgress } from './progress';
import type { Challenge } from './schema';
import { useStarterLauncher } from './StarterLauncher';
import './learn.css';

export const CATEGORIES = [
  { id: 'model', title: 'Model', blurb: 'Specify constructs, measurement and structure.' },
  { id: 'diagnose', title: 'Diagnose', blurb: 'Find what is wrong with a model, data set or run.' },
  { id: 'analyze', title: 'Analyze', blurb: 'Choose settings and run the analysis.' },
  { id: 'interpret', title: 'Interpret', blurb: 'Read results and judge what they support.' },
  { id: 'report', title: 'Report', blurb: 'Write up methods and results transparently.' },
] as const;

const METHOD = { pls: 'PLS-SEM', cb: 'CB-SEM', both: 'PLS & CB' } as const;
const DIMENSION_LABEL = {
  structure: 'Structure',
  mapping: 'Data mapping',
  estimator: 'Estimator choice',
  numeric: 'Numeric accuracy',
  interpretation: 'Interpretation',
  reporting: 'Reporting',
} as const;

const difficultyText = (d: number): string => ['', 'Easy', 'Moderate', 'Demanding'][d] ?? '';

function DifficultyChip({ level }: { level: number }) {
  return (
    <Badge variant="neutral" aria-label={`Difficulty ${level} of 3: ${difficultyText(level)}`}>
      <span aria-hidden="true">
        {'●'.repeat(level)}
        {'○'.repeat(3 - level)}
      </span>{' '}
      {difficultyText(level)}
    </Badge>
  );
}

function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const progress = useProgress((s) => s.challenges[challenge.id]);
  const lessons = useContent((c) => c.lessons);
  const sum = summarizeChallenge(challenge, progress);
  const active = useActiveChallenge((s) => s.challengeId === challenge.id);
  return (
    <Card className="ch-card" role="group" aria-label={challenge.title}>
      <div className="ch-card__chips">
        <Badge variant="info">{METHOD[challenge.method]}</Badge>
        <DifficultyChip level={challenge.difficulty} />
        {sum.complete ? <Badge variant="success">Completed</Badge> : null}
        {active ? <Badge variant="accent">Active</Badge> : null}
      </div>
      <h3 className="ch-card__title">
        <Link to={`/challenges/${challenge.id}`}>
          <span className="ch-card__num">#{challenge.number}</span> {challenge.title}
        </Link>
      </h3>
      <p className="ch-card__text">
        <InlineText text={firstText(challenge)} noTerms />
      </p>
      {challenge.prerequisiteLessons.length > 0 ? (
        <p className="ch-muted">
          Lesson:{' '}
          {challenge.prerequisiteLessons
            .map((id) => lessons.find((l) => l.id === id)?.title ?? id)
            .join(', ')}
        </p>
      ) : null}
      <ProgressBar
        label={`${sum.solved} of ${sum.total} tasks solved`}
        value={sum.solved}
        max={sum.total}
        showValue={false}
      />
    </Card>
  );
}

function firstText(c: Challenge): string {
  const b = c.brief[0];
  return b && b.kind === 'p' ? b.text : c.skills.join(' · ');
}

function ChallengeList() {
  const challenges = useContent((c) => c.challenges);
  if (challenges.length === 0)
    return (
      <EmptyState icon={<Target />} title="No challenges available yet">
        <p>Challenges will appear here as soon as the learning content is added to this build.</p>
      </EmptyState>
    );
  return (
    <>
      {CATEGORIES.map((cat) => {
        const items = challenges.filter((c) => c.category === cat.id);
        if (items.length === 0) return null;
        return (
          <section key={cat.id} aria-labelledby={`cat-${cat.id}`} className="ch-category">
            <h2 id={`cat-${cat.id}`}>{cat.title}</h2>
            <p className="ch-muted">{cat.blurb}</p>
            <div className="ch-grid">
              {items.map((c) => (
                <ChallengeCard key={c.id} challenge={c} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function ChallengeView({ challenge }: { challenge: Challenge }) {
  const navigate = useNavigate();
  const lessons = useContent((c) => c.lessons);
  const progress = useProgress((s) => s.challenges[challenge.id]);
  const skills = useProgress((s) => s.skills);
  const { challengeId, start, stop } = useActiveChallenge();
  const active = challengeId === challenge.id;
  const launcher = useStarterLauncher(() => start(challenge.id));
  const sum = summarizeChallenge(challenge, progress);
  const workspace = challenge.tasks.some(isWorkspaceTask);

  function onStart() {
    if (challenge.starter) launcher.request(challenge.starter);
    else {
      start(challenge.id);
      const first = challenge.tasks.find(isWorkspaceTask);
      if (first)
        void navigate(
          first.kind === 'model' ? '/modeler' : first.kind === 'mapping' ? '/data' : '/analysis',
        );
    }
  }

  return (
    <article className="ch-view" aria-labelledby="challenge-title">
      <Link to="/challenges" className="ch-back">
        <ArrowLeft size={14} aria-hidden="true" /> All challenges
      </Link>
      <header className="learn-article__head">
        <div className="learn-article__meta">
          <Badge variant="neutral">
            {CATEGORIES.find((c) => c.id === challenge.category)?.title}
          </Badge>
          <Badge variant="info">{METHOD[challenge.method]}</Badge>
          <DifficultyChip level={challenge.difficulty} />
          {sum.complete ? <Badge variant="success">Completed</Badge> : null}
        </div>
        <h2 id="challenge-title">{challenge.title}</h2>
        {challenge.prerequisiteLessons.length > 0 ? (
          <p className="ch-muted">
            Prepared by:{' '}
            {challenge.prerequisiteLessons.map((id, i) => (
              <span key={id}>
                {i > 0 ? ', ' : ''}
                <Link to={`/learn/${id}`}>{lessons.find((l) => l.id === id)?.title ?? id}</Link>
              </span>
            ))}
          </p>
        ) : null}
      </header>

      <Blocks blocks={challenge.brief} />

      <div className="ch-start">
        {active ? (
          <>
            <Badge variant="accent">Active challenge</Badge>
            <Button icon={<Square size={14} />} onClick={stop}>
              Stop challenge
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            icon={<Play size={16} />}
            disabled={launcher.busy}
            onClick={onStart}
          >
            Start{challenge.starter ? `: ${challenge.starter.title}` : ''}
          </Button>
        )}
        <span className="ch-muted">
          {challenge.starter
            ? 'Opens the starter as a new project; your current one stays saved. '
            : ''}
          {workspace
            ? 'While active, the challenge stays docked on the Modeler, Data, Analysis and Results pages.'
            : ''}
        </span>
      </div>
      {launcher.dialog}

      <section aria-labelledby="tasks-title">
        <h3 id="tasks-title">Tasks</h3>
        <ChallengeTasks challenge={challenge} />
      </section>

      <section aria-labelledby="score-title" className="ch-score">
        <h3 id="score-title">Your progress</h3>
        <Table aria-label="Score by dimension">
          <thead>
            <tr>
              <Th>Dimension</Th>
              <Th numeric>Solved</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(sum.dimensions).map(([d, v]) => (
              <tr key={d}>
                <Td>{DIMENSION_LABEL[d as keyof typeof DIMENSION_LABEL]}</Td>
                <Td numeric>
                  {v.solved} of {v.total}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="ch-muted">
          Your best result is kept; retries are always allowed, and hints do not lower it. Hints
          used: {progress?.hintsUsed ?? 0} of {challenge.hints.length}.
        </p>
        {sum.complete ? (
          <Callout variant="success" title="Challenge completed">
            Skills achieved:{' '}
            {challenge.skills.filter((s) => skills[s]).join(', ') || challenge.skills.join(', ')}.
          </Callout>
        ) : null}
      </section>

      <SolutionSection challenge={challenge} />

      {challenge.nextLesson ? (
        <p>
          <Link
            to={`/learn/${challenge.nextLesson}`}
            className="learn-pager__link learn-pager__link--next"
          >
            <span>
              Next: {lessons.find((l) => l.id === challenge.nextLesson)?.title ?? 'lesson'}
            </span>{' '}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </p>
      ) : null}
    </article>
  );
}

export function ChallengesPage() {
  const { challengeId } = useParams();
  const challenges = useContent((c) => c.challenges);
  useLoadProgress();
  const challenge = challenges.find((c) => c.id === challengeId);
  return (
    <>
      <PageHeader
        eyebrow="Learn"
        title="Challenges"
        description="Practice modeling, diagnosing, analyzing, interpreting and reporting. Hints come one at a time, retries are free, and your best result is kept."
      />
      {challengeId ? (
        challenge ? (
          <ChallengeView challenge={challenge} />
        ) : (
          <EmptyState icon={<Target />} title="Challenge not found">
            <p>
              There is no challenge with this address.{' '}
              <Link to="/challenges">See all challenges</Link>.
            </p>
          </EmptyState>
        )
      ) : (
        <ChallengeList />
      )}
    </>
  );
}
