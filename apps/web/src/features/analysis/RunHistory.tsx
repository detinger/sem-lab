import { Link } from 'react-router-dom';
import { Badge, Table, Td, Th } from '@/components/ui';
import { STALE_LABEL, type RunView, useRuns } from './runs';

const STATUS_TEXT = {
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const;

const METHOD_TEXT = { 'pls-sem': 'PLS-SEM', plsc: 'PLSc', 'cb-sem': 'CB-SEM' } as const;

/** "2.4 s", "840 ms", "1 min 12 s" — a measured wall-clock time. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

export function RunHistory({ runs }: { runs: RunView[] }) {
  return (
    <section className="an-card" aria-labelledby="an-history">
      <div className="an-card__head">
        <h2 id="an-history" className="an-h2">
          Run history
        </h2>
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
              <Th numeric>Duration</Th>
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
                  <Td numeric>{r.durationMs !== undefined ? formatDuration(r.durationMs) : '–'}</Td>
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
