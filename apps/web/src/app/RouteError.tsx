import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useRouteError } from 'react-router-dom';

import { Button, Card, EmptyState, PageHeader } from '@/components/ui';

import { isChunkLoadError, reloadForStaleChunk } from './staleChunk';

/**
 * Route-level error boundary. A failed page chunk is almost always a stale deploy: the
 * `vite:preloadError` handler reloads before this renders, so this is the fallback for when the
 * reload guard has already fired (e.g. the user is offline). Other errors show a generic message.
 */
export function RouteError() {
  const error = useRouteError();

  if (isChunkLoadError(error)) {
    return (
      <>
        <PageHeader
          title="Update available"
          description="This page couldn’t load because a newer version of SEM Lab was published."
        />
        <Card>
          <EmptyState
            icon={<RefreshCw />}
            title="Reload to continue"
            action={
              <Button variant="primary" onClick={() => reloadForStaleChunk()}>
                Reload
              </Button>
            }
          >
            <p>Your work is saved. Reloading loads the latest version of the page.</p>
          </EmptyState>
        </Card>
      </>
    );
  }

  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  return (
    <>
      <PageHeader title="Something went wrong" description="This page hit an unexpected error." />
      <Card>
        <EmptyState
          icon={<TriangleAlert />}
          title="Unexpected error"
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          <p>{message}</p>
        </EmptyState>
      </Card>
    </>
  );
}
