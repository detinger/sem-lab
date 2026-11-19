import { ChartColumnIncreasing, FileText, FlaskConical, Table, Workflow } from 'lucide-react';

import { ProgressCard } from '@/features/learn/ProgressCard';
import { Badge, Card, CardHeader, EmptyState, LinkCard, PageHeader } from '@/components/ui';

import './pages.css';

const STEPS = [
  {
    step: 1,
    title: 'Import data',
    body: 'Load a CSV file and map its columns to your indicators.',
    to: '/data',
    icon: Table,
  },
  {
    step: 2,
    title: 'Build model',
    body: 'Draw constructs and indicators, then connect them with paths.',
    to: '/modeler',
    icon: Workflow,
  },
  {
    step: 3,
    title: 'Analyze',
    body: 'Choose an estimator, set options and run the analysis.',
    to: '/analysis',
    icon: FlaskConical,
  },
  {
    step: 4,
    title: 'Report',
    body: 'Review results and copy tables into your manuscript.',
    to: '/results',
    icon: ChartColumnIncreasing,
  },
] as const;

export function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Overview"
        description="Import your data, build a structural equation model and analyze it, all in one place."
      />

      <section aria-labelledby="workflow-heading" className="overview__section">
        <h2 id="workflow-heading">Workflow</h2>
        <div className="card-grid card-grid--workflow">
          {STEPS.map(({ step, title, body, to, icon: Icon }) => (
            <LinkCard key={to} to={to}>
              <div className="workflow-card__top">
                <span className="workflow-card__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <Badge variant="neutral">Step {step}</Badge>
              </div>
              <h3 className="workflow-card__title">{title}</h3>
              <p className="workflow-card__body">{body}</p>
            </LinkCard>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="overview__section">
        <h2 id="recent-heading">Recent projects</h2>
        <Card>
          <CardHeader title="Saved in this browser" level={3} />
          <EmptyState level={4} icon={<FileText />} title="No projects yet">
            <p>
              Models you create in the Modeler will be listed here, so you can pick up where you
              left off.
            </p>
          </EmptyState>
        </Card>
      </section>

      <section aria-labelledby="learning-heading" className="overview__section">
        <h2 id="learning-heading">Learning</h2>
        <ProgressCard />
      </section>
    </>
  );
}
