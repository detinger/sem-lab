import type { LucideIcon } from 'lucide-react';

import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';

export interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Roadmap phase that delivers the page, e.g. "Phase 2". */
  phase: string;
  /** What the page will contain, one honest sentence. */
  willContain: string;
}

/** A route whose feature is not built yet. Says so plainly and shows no data. */
export function PlaceholderPage({
  title,
  description,
  icon: Icon,
  phase,
  willContain,
}: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState
          icon={<Icon />}
          title={`${title} is not available yet`}
          action={<Badge variant="info">Planned for {phase}</Badge>}
        >
          <p>{willContain}</p>
          <p>
            Nothing is shown here until the feature exists. No sample values are displayed in its
            place.
          </p>
        </EmptyState>
      </Card>
    </>
  );
}
