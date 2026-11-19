import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Table, Td, Th, useToast } from '@/components/ui';
import { deleteServerJob } from './jobs';
import { STALE_LABEL, type RunView, useRuns } from './runs';

const STATUS_TEXT = {
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const;

const METHOD_TEXT = { 'pls-sem': 'PLS-SEM', plsc: 'PLSc', 'cb-sem': 'CB-SEM' } as const;

export function RunHistory({ runs, activeRunId }: { runs: RunView[]; activeRunId: string | null }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const withJobs = runs.filter((r) => r.serverJobId && r.runId !== activeRunId);

  const remove = async (list: RunView[]): Promise<void> => {
    setBusy(true);
    let failed = 0;
    for (const r of list) if (!(await deleteServerJob(r)).ok) failed++;
    setBusy(false);
    toast(
      failed === 0
        ? { title: 'Uploaded data and jobs deleted from the service', variant: 'success' }
        : {
            title: `${failed} job${failed === 1 ? '' : 's'} could not be deleted`,
            description: 'The service could not be reached. Try again later.',
            variant: 'error',
          },
    );
  };

  return (
    <section className="an-card" aria-labelledby="an-history">
      <div className="an-card__head">
        <h2 id="an-history" className="an-h2">
          Run history
        </h2>
        <Button
          size="small"
          icon={<Trash2 size={14} />}
          disabled={busy || withJobs.length === 0}
          onClick={() => void remove(withJobs)}
        >
          Delete uploaded data and jobs for this project
        </Button>
      </div>
      {runs.length === 0 ? (
        <p className="an-note">No runs yet. A finished run is kept in this browser.</p>
      ) : (
        <Table aria-label="Run history">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Method</Th>
              <Th numeric>B</Th>
              <Th numeric>Seed</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const o = r.record.options;
              return (
                <tr key={r.runId}>
                  <Td>
                    {new Date(r.createdAt).toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Td>
                  <Td>{METHOD_TEXT[r.record.method]}</Td>
                  <Td numeric>
                    {o.bootstrap?.enabled ? o.bootstrap.repetitions.toLocaleString('en') : '–'}
                  </Td>
                  <Td numeric>{o.seed ?? '–'}</Td>
                  <Td>
                    <span className="an-status">
                      {STATUS_TEXT[r.record.status]}
                      {r.staleness !== 'current' ? (
                        <Badge variant="warning">{STALE_LABEL[r.staleness]}</Badge>
                      ) : null}
                    </span>
                  </Td>
                  <Td>
                    <span className="an-actions">
                      {r.record.status === 'complete' ? (
                        <Link to="/results" onClick={() => useRuns.getState().select(r.runId)}>
                          Open results
                        </Link>
                      ) : null}
                      <Button
                        size="small"
                        variant="ghost"
                        icon={<Trash2 size={14} />}
                        disabled={busy || !r.serverJobId || r.runId === activeRunId}
                        aria-label={`Delete uploaded data and job for the run of ${new Date(r.createdAt).toLocaleString('en-GB')}`}
                        onClick={() => void remove([r])}
                      >
                        Delete uploaded data
                      </Button>
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </section>
  );
}
