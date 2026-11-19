import { Ban, CircleAlert } from 'lucide-react';
import { Button, Callout, ProgressBar, Spinner, Table, Td, Th } from '@/components/ui';
import type { ActiveJob, Outcome } from './jobs';
import { ERROR_HINTS, hintFor } from './errorHints';

const STAGE_TEXT: Record<string, string> = {
  validating: 'Validating the request',
  estimating: 'Estimating the model',
  bootstrapping: 'Bootstrapping',
  summarizing: 'Summarizing the results',
};

export function stageText(active: ActiveJob): string {
  const stage = active.progress?.stage;
  return stage ? (STAGE_TEXT[stage] ?? 'Running') : 'Starting the engine';
}

export function RunProgress({ active, onCancel }: { active: ActiveJob; onCancel: () => void }) {
  const p = active.progress;
  const bar =
    p !== null &&
    p.stage === 'bootstrapping' &&
    p.done !== undefined &&
    p.total !== undefined &&
    p.total > 0
      ? { done: p.done, total: p.total, failed: p.failed ?? 0, inadmissible: p.inadmissible ?? 0 }
      : null;
  return (
    <section className="an-card" aria-label="Analysis in progress">
      <div className="an-card__head">
        <h2 className="an-h2">Analysis running</h2>
        <Button
          size="small"
          icon={<Ban size={14} />}
          disabled={active.cancelRequested}
          onClick={onCancel}
        >
          {active.cancelRequested ? 'Cancelling…' : 'Cancel'}
        </Button>
      </div>
      <p className="an-stage" role="status">
        {stageText(active)}
      </p>
      {bar ? (
        <ProgressBar
          value={bar.done}
          max={bar.total}
          label={`${bar.done.toLocaleString('en')} of ${bar.total.toLocaleString('en')} bootstrap samples (${bar.failed} failed, ${bar.inadmissible} inadmissible)`}
        />
      ) : (
        <Spinner label={stageText(active)} />
      )}
    </section>
  );
}

export function RunFailure({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  const f = outcome.failure ?? { code: 'ENGINE_INTERNAL', message: 'The job failed.' };
  if (outcome.status === 'cancelled')
    return (
      <Callout variant="info" title="Analysis cancelled">
        <p>The run was cancelled; it produced no results.</p>
        <Button size="small" onClick={onDismiss}>
          Dismiss
        </Button>
      </Callout>
    );
  return (
    <section className="an-card" aria-label="Analysis failed">
      <Callout variant="error" title="Analysis did not finish">
        <p>
          <strong>Error code:</strong> <code>{f.code}</code>
        </p>
        <p>{f.message}</p>
        <p>
          <strong>What to do:</strong> {hintFor(f.code)}
        </p>
        <Button size="small" icon={<CircleAlert size={14} />} onClick={onDismiss}>
          Dismiss
        </Button>
      </Callout>
      <details className="an-tech">
        <summary>All error codes and fixes</summary>
        <Table aria-label="Error codes and fixes">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>What to do</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(ERROR_HINTS).map(([code, hint]) => (
              <tr key={code}>
                <Td>
                  <code>{code}</code>
                </Td>
                <Td>{hint}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </details>
    </section>
  );
}
