import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Card, EmptyState, PageHeader } from '@/components/ui';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" description="There is no page at this address." />
      <Card>
        <EmptyState
          icon={<Compass />}
          title="Nothing here"
          action={
            <Link to="/" className="ui-btn ui-btn--primary">
              Go to Overview
            </Link>
          }
        >
          <p>The address may be mistyped, or the page may have moved.</p>
        </EmptyState>
      </Card>
    </>
  );
}
