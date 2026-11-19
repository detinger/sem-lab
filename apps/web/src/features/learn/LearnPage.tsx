import { ArrowLeft, ArrowRight, BookOpen, CircleCheck, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressBar,
} from '@/components/ui';
import { Blocks } from './Blocks';
import { resolveCitations, useContent } from './content';
import { evaluateChoice } from './evaluate';
import { InlineText } from './inline';
import { FindingList } from './ChallengeTasks';
import { isLessonComplete, useLoadProgress, useProgress } from './progress';
import type { KnowledgeCheck as Check, Lesson } from './schema';
import { useStarterLauncher } from './StarterLauncher';
import './learn.css';

const LEVEL_NAMES: Record<number, string> = {
  1: 'Level 1 · Foundations',
  2: 'Level 2 · Measurement',
  3: 'Level 3 · Structure',
  4: 'Level 4 · Assessment',
  5: 'Level 5 · Advanced topics',
  6: 'Level 6 · Reporting',
};

function LessonIndex({ lessons, activeId }: { lessons: Lesson[]; activeId?: string | undefined }) {
  const done = useProgress((s) => s.lessons);
  const levels = [...new Set(lessons.map((l) => l.level))].sort();
  const completed = lessons.filter((l) => isLessonComplete(done[l.id])).length;
  return (
    <nav className="learn-index" aria-label="Lessons">
      <ProgressBar
        label="Lessons completed"
        value={completed}
        max={Math.max(lessons.length, 1)}
        showValue={false}
      />
      <p className="learn-index__count">
        {completed} of {lessons.length} completed
      </p>
      {levels.map((level) => (
        <div key={level} role="group" aria-label={LEVEL_NAMES[level] ?? `Level ${level}`}>
          <h2 className="learn-index__level">{LEVEL_NAMES[level] ?? `Level ${level}`}</h2>
          <ul>
            {lessons
              .filter((l) => l.level === level)
              .map((l) => {
                const complete = isLessonComplete(done[l.id]);
                return (
                  <li key={l.id}>
                    <Link
                      to={`/learn/${l.id}`}
                      className="learn-index__link"
                      aria-current={l.id === activeId ? 'page' : undefined}
                    >
                      <span className="learn-index__mark" aria-hidden="true">
                        {complete ? (
                          <CircleCheck size={15} />
                        ) : (
                          <span className="learn-index__dot" />
                        )}
                      </span>
                      <span>
                        {l.title}
                        {complete ? <span className="sr-only"> (completed)</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function KnowledgeCheck({ lesson, check }: { lesson: Lesson; check: Check }) {
  const saved = useProgress((s) => s.lessons[lesson.id]?.checks[check.id]);
  const answerCheck = useProgress((s) => s.answerCheck);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ReturnType<typeof evaluateChoice> | null>(null);
  const locked = result !== null;
  return (
    <fieldset className="learn-check" disabled={false}>
      <legend>
        <InlineText text={check.question} />
      </legend>
      {check.multiple ? <p className="learn-check__hint">Select all that apply.</p> : null}
      <div className="ch-options">
        {check.options.map((o) => (
          <label key={o.id} className="ch-option">
            <input
              type={check.multiple ? 'checkbox' : 'radio'}
              name={`${lesson.id}-${check.id}`}
              disabled={locked}
              checked={selected.includes(o.id)}
              onChange={(e) =>
                setSelected((cur) =>
                  check.multiple
                    ? e.target.checked
                      ? [...cur, o.id]
                      : cur.filter((x) => x !== o.id)
                    : [o.id],
                )
              }
            />
            <span>
              <InlineText text={o.text} />
            </span>
          </label>
        ))}
      </div>
      {!locked ? (
        <div className="ch-task__actions">
          <Button
            size="small"
            variant="primary"
            disabled={selected.length === 0}
            onClick={() => {
              const r = evaluateChoice(check, selected);
              setResult(r);
              void answerCheck(lesson, check.id, r.correct);
            }}
          >
            Check answer
          </Button>
          {saved?.correct ? <Badge variant="success">Answered correctly before</Badge> : null}
        </div>
      ) : (
        <div role="status" aria-live="polite" className="ch-result">
          <p className="ch-result__head">{result.correct ? 'Correct' : 'Not quite'}</p>
          <FindingList findings={result.findings} />
          <p className="learn-check__explain">
            <strong>Why: </strong>
            <InlineText text={check.explanation} />
          </p>
          {!result.correct ? (
            <Button
              size="small"
              onClick={() => {
                setResult(null);
                setSelected([]);
              }}
            >
              Try again
            </Button>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}

function LessonArticle({ lesson, lessons }: { lesson: Lesson; lessons: Lesson[] }) {
  const citations = useContent((c) => c.citations);
  const heading = useRef<HTMLHeadingElement>(null);
  const launcher = useStarterLauncher();
  const done = useProgress((s) => isLessonComplete(s.lessons[lesson.id]));
  const index = lessons.findIndex((l) => l.id === lesson.id);
  const prev = lessons[index - 1];
  const next = lessons[index + 1];
  const refs = useMemo(
    () => resolveCitations(lesson.references, citations),
    [lesson.references, citations],
  );
  useEffect(() => {
    heading.current?.focus();
  }, [lesson.id]);
  return (
    <article className="learn-article" aria-labelledby="lesson-title">
      <header className="learn-article__head">
        <div className="learn-article__meta">
          <Badge variant="info">Level {lesson.level}</Badge>
          <Badge variant="neutral">{lesson.minutes} min</Badge>
          {done ? <Badge variant="success">Completed</Badge> : null}
          {lesson.prerequisites.map((p) => {
            const pre = lessons.find((l) => l.id === p);
            return pre ? (
              <Link key={p} to={`/learn/${p}`} className="learn-article__prereq">
                Before: {pre.title}
              </Link>
            ) : null;
          })}
        </div>
        <h2 id="lesson-title" ref={heading} tabIndex={-1}>
          {lesson.title}
        </h2>
        <p className="learn-article__summary">
          <InlineText text={lesson.summary} />
        </p>
      </header>

      <Blocks blocks={lesson.body} />

      <Callout variant="warning" title={`Common mistake: ${lesson.mistake.title}`}>
        <InlineText text={lesson.mistake.text} />
      </Callout>

      {lesson.tryIt ? (
        <Card className="learn-tryit">
          <CardHeader title="Try it" icon={<Play size={16} />} level={3} />
          <p>
            <InlineText text={lesson.tryIt.task} />
          </p>
          <Button
            variant="primary"
            icon={<Play size={16} />}
            disabled={launcher.busy}
            onClick={() => lesson.tryIt && launcher.request(lesson.tryIt.starter)}
          >
            Try it: {lesson.tryIt.starter.title}
          </Button>
          <p className="ch-muted">Opens as a new project; your current one stays saved.</p>
          {launcher.dialog}
        </Card>
      ) : null}

      <section aria-labelledby="checks-title" className="learn-checks">
        <h3 id="checks-title">Check your understanding</h3>
        {lesson.checks.map((c) => (
          <KnowledgeCheck key={`${lesson.id}-${c.id}`} lesson={lesson} check={c} />
        ))}
      </section>

      <section aria-labelledby="refs-title" className="learn-refs">
        <h3 id="refs-title">References</h3>
        <ul>
          {refs.map((r) => (
            <li key={r.key}>
              {r.text}
              {r.doi ? (
                <>
                  {' '}
                  <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">
                    doi:{r.doi}
                  </a>
                </>
              ) : null}
              {!r.known ? <span className="ch-muted"> (reference text not available)</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <nav className="learn-pager" aria-label="Previous and next lesson">
        {prev ? (
          <Link to={`/learn/${prev.id}`} className="learn-pager__link">
            <ArrowLeft size={16} aria-hidden="true" /> <span>Previous: {prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={`/learn/${next.id}`} className="learn-pager__link learn-pager__link--next">
            <span>Next: {next.title}</span> <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : null}
      </nav>
    </article>
  );
}

export function LearnPage() {
  const { lessonId } = useParams();
  const lessons = useContent((c) => c.lessons);
  const done = useProgress((s) => s.lessons);
  useLoadProgress();
  const lesson = lessons.find((l) => l.id === lessonId);
  const first = lessons.find((l) => !isLessonComplete(done[l.id])) ?? lessons[0];
  return (
    <>
      <PageHeader
        eyebrow="Learn"
        title="Lessons"
        description="Short lessons on structural equation modeling: one concept each, with an interactive demo, a common mistake and a knowledge check."
      />
      {lessons.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="No lessons available yet">
          <p>Lessons will appear here as soon as the learning content is added to this build.</p>
        </EmptyState>
      ) : (
        <div className="learn-layout">
          <LessonIndex lessons={lessons} activeId={lessonId} />
          <div className="learn-main">
            {lesson ? (
              <LessonArticle lesson={lesson} lessons={lessons} />
            ) : lessonId ? (
              <EmptyState icon={<BookOpen />} title="Lesson not found">
                <p>There is no lesson with this address. Pick one from the list.</p>
              </EmptyState>
            ) : (
              <Card className="learn-welcome">
                <CardHeader title="Start here" level={2} icon={<BookOpen size={18} />} />
                <p>
                  Work through the lessons in order, or jump to the one you need. Each ends with a
                  short knowledge check, and a lesson counts as complete once you have answered all
                  its checks correctly.
                </p>
                {first ? (
                  <Link
                    className="ui-btn ui-btn--primary learn-welcome__go"
                    to={`/learn/${first.id}`}
                  >
                    {isLessonComplete(done[first.id]) ? 'Review' : 'Start'}: {first.title}
                  </Link>
                ) : null}
                <p className="ch-muted">
                  See also the <Link to="/challenges">challenges</Link> and the{' '}
                  <Link to="/reference">reference</Link>. Everything stays in this browser.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
