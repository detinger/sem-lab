import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { useMemo } from 'react';
import type { NormalizedSemResult } from '@sem-studio/contracts';
import {
  Callout,
  EmptyState,
  Field,
  KpiGrid,
  KpiTile,
  PageHeader,
  SegmentedControl,
  Select,
  Switch,
  Tabs,
} from '@/components/ui';
import { STALE_LABEL, type RunView, useProjectRuns, useRuns } from '@/features/analysis/runs';
import { useProjectData } from '@/features/data-lab/useProjectData';
import { useModeler } from '@/features/modeler/store';
import { formatNumber } from '../reports/format';
import type { ReportTable } from '../reports/table';
import { BootstrapSection } from './BootstrapChart';
import { ExportRButton } from './ExportR';
import { ResultTable } from './ResultTable';
import { styleOf, useResultStyle } from './store';
import {
  type TableContext,
  effectsTable,
  fitTable,
  loadingsTable,
  matrixTable,
  pathsTable,
  r2Table,
  reliabilityTable,
} from './tables';
import './results.css';

const METHOD_TEXT = { 'pls-sem': 'PLS-SEM', plsc: 'PLSc', 'cb-sem': 'CB-SEM' } as const;
const short = (h: string): string => h.slice(0, 8);

function Provenance({ run }: { run: RunView }) {
  const r = run.record.result!;
  const o = run.record.options;
  const b = r.bootstrap;
  const cs = r.provenance.packageVersions['cSEM'];
  const parts = [
    `${METHOD_TEXT[run.record.method]}${o.pls ? `, ${o.pls.innerWeighting} weighting` : ''}`,
    `${r.provenance.engine}${cs ? ` (cSEM ${cs})` : ''}`,
    `N = ${r.sample.nUsed}${r.sample.nDropped ? `, ${r.sample.nDropped} dropped` : ''}`,
    new Date(r.provenance.finishedAt).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    b
      ? `seed ${b.seed}, B = ${b.requested.toLocaleString('en')} (${b.completed.toLocaleString('en')} valid, ${b.failed} failed, ${b.inadmissible} inadmissible)`
      : 'no bootstrap',
    `model ${short(run.modelHash)}`,
    `data ${short(run.dataFingerprint)}`,
    `${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}`,
  ];
  return (
    <div className="rs-prov">
      <p className="rs-prov__line" aria-label="Run provenance">
        {parts.join(' · ')}
      </p>
      <details className="rs-details">
        <summary>Full provenance</summary>
        <dl className="rs-dl">
          <dt>Model hash</dt>
          <dd>
            <code>{run.modelHash}</code>
          </dd>
          <dt>Data fingerprint</dt>
          <dd>
            <code>{run.dataFingerprint}</code>
          </dd>
          <dt>Package versions</dt>
          <dd>
            {Object.entries(r.provenance.packageVersions)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ')}
            {r.provenance.rVersion ? `, R ${r.provenance.rVersion}` : ''}
          </dd>
          <dt>Engine call (as returned; aliases C1…, X1…)</dt>
          <dd>
            <pre className="rs-pre">{r.provenance.call}</pre>
          </dd>
        </dl>
      </details>
    </div>
  );
}

function missingMatrixNote(
  r: NormalizedSemResult,
  id: string,
  title: string,
): ReportTable | string | null {
  const m = r.matrices.find((x) => x.id === id);
  if (!m) return null;
  return m.rowIds.length === 0
    ? `${title} is not available for this model (${m.missing ?? 'not applicable'}).`
    : null;
}

function Tables({ ids }: { ids: Array<ReportTable | string | null> }) {
  return (
    <>
      {ids.map((t, i) =>
        t === null ? null : typeof t === 'string' ? (
          <p key={i} className="rs-empty">
            {t}
          </p>
        ) : (
          <ResultTable key={t.id} table={t} />
        ),
      )}
    </>
  );
}

function ResultBody({ run }: { run: RunView }) {
  const sty = useResultStyle();
  const projectName = useModeler((s) => s.projectName);
  const result = run.record.result!;
  const style = styleOf(sty);
  const ctx: TableContext = { model: run.model, result, analysis: run.record.options, style };
  const matrix = (id: string, tri: 'lower' | 'full' = 'lower'): ReportTable | string | null => {
    const empty = missingMatrixNote(
      result,
      id,
      result.matrices.find((x) => x.id === id)?.title ?? id,
    );
    return empty ?? matrixTable(ctx, id, tri);
  };
  const r2s = result.constructMetrics
    .filter((m) => m.metric === 'r2' && m.value !== null)
    .map((m) => m.value!);
  const hasF2 = result.matrices.some((m) => m.id === 'f2' && m.rowIds.length > 0);
  const boot = result.bootstrap;

  const summary = (
    <>
      <KpiGrid>
        <KpiTile
          label="Observations used"
          value={result.sample.nUsed.toLocaleString('en')}
          detail={
            result.sample.nDropped
              ? `${result.sample.nDropped} of ${result.sample.nRows} rows dropped (listwise)`
              : 'no rows dropped'
          }
        />
        <KpiTile
          label="Constructs"
          value={run.model.constructs.length}
          detail={`${run.model.indicators.length} indicators`}
        />
        <KpiTile
          label="R² range"
          value={
            r2s.length
              ? `${formatNumber(Math.min(...r2s), style)} – ${formatNumber(Math.max(...r2s), style)}`
              : '–'
          }
          detail={
            r2s.length
              ? `${r2s.length} endogenous construct${r2s.length === 1 ? '' : 's'}`
              : 'no endogenous constructs'
          }
        />
        <KpiTile
          label="Valid bootstrap draws"
          value={boot ? boot.completed.toLocaleString('en') : '–'}
          detail={
            boot ? `of ${boot.requested.toLocaleString('en')} requested` : 'no bootstrap was run'
          }
        />
      </KpiGrid>
      <p className="rs-notes">
        Estimation {result.estimation.converged ? 'converged' : 'did not converge'}
        {result.estimation.iterations !== null
          ? ` after ${result.estimation.iterations} iterations`
          : ''}
        ; admissibility check:{' '}
        {result.estimation.admissible === null
          ? 'not assessed'
          : result.estimation.admissible
            ? 'passed'
            : 'failed'}
        .
      </p>
      <h3 className="rs-h3">Warnings ({result.warnings.length})</h3>
      {result.warnings.length === 0 ? (
        <p className="rs-empty">The engine reported no warnings.</p>
      ) : (
        <ul className="rs-warnings">
          {result.warnings.map((w, i) => (
            <li key={i}>
              <strong>{w.severity}</strong> <code>{w.code}</code> {w.message}
            </li>
          ))}
        </ul>
      )}
      {result.estimation.messages.length > 0 ? (
        <>
          <h3 className="rs-h3">Engine messages</h3>
          <ul className="rs-warnings">
            {result.estimation.messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );

  return (
    <>
      <Provenance run={run} />
      <Tabs
        aria-label="Result sections"
        items={[
          { id: 'summary', label: 'Summary', content: <div className="rs-pane">{summary}</div> },
          {
            id: 'measurement',
            label: 'Measurement',
            content: (
              <div className="rs-pane">
                <Tables
                  ids={[
                    loadingsTable(ctx),
                    reliabilityTable(ctx),
                    matrix('htmt'),
                    matrix('htmt2'),
                    matrix('fornell-larcker'),
                    matrix('cross-loadings', 'full'),
                    matrix('construct-correlations'),
                    matrix('vif-indicator-mode-b', 'full'),
                  ]}
                />
              </div>
            ),
          },
          {
            id: 'structural',
            label: 'Structural',
            content: (
              <div className="rs-pane">
                <Tables
                  ids={[
                    pathsTable(ctx),
                    r2Table(ctx),
                    hasF2 ? matrix('f2', 'full') : null,
                    matrix('vif-structural', 'full'),
                    effectsTable(ctx),
                  ]}
                />
              </div>
            ),
          },
          {
            id: 'bootstrap',
            label: 'Bootstrap',
            content: (
              <div className="rs-pane">
                <BootstrapSection model={run.model} result={result} style={style} />
              </div>
            ),
          },
          {
            id: 'fit',
            label: 'Fit',
            content: (
              <div className="rs-pane">
                <ResultTable table={fitTable(ctx)} />
              </div>
            ),
          },
          {
            id: 'repro',
            label: 'Reproducibility',
            content: (
              <div className="rs-pane">
                <dl className="rs-dl">
                  <dt>Model hash</dt>
                  <dd>
                    <code>{run.modelHash}</code>
                  </dd>
                  <dt>Data fingerprint</dt>
                  <dd>
                    <code>{run.dataFingerprint}</code>
                  </dd>
                  <dt>Engine and versions</dt>
                  <dd>
                    {result.provenance.engine};{' '}
                    {Object.entries(result.provenance.packageVersions)
                      .map(([k, v]) => `${k} ${v}`)
                      .join(', ')}
                    {result.provenance.rVersion ? `; R ${result.provenance.rVersion}` : ''}
                  </dd>
                  <dt>Seed, B and chunk size</dt>
                  <dd>
                    {boot
                      ? `seed ${boot.seed}; B = ${boot.requested}; ${boot.completed} valid, ${boot.failed} failed, ${boot.inadmissible} inadmissible; chunk size ${boot.chunkSize}`
                      : 'no bootstrap was run'}
                  </dd>
                </dl>
                <h3 className="rs-h3">Method statement</h3>
                <p className="rs-prose">
                  {METHOD_TEXT[run.record.method]} was estimated with the R package cSEM (
                  {result.provenance.packageVersions['cSEM'] ?? 'version not reported'}), engine
                  r-csem. Constructs are composites: Mode A weights for reflective blocks and Mode B
                  for composite blocks
                  {run.record.method === 'plsc'
                    ? ', with the consistency correction applied to reflective constructs'
                    : ', without a consistency correction'}
                  . Estimates are standardized.{' '}
                  {boot
                    ? `Standard errors, t, p and ${Math.round(boot.confidenceLevel * 100)}% percentile intervals come from ${boot.completed} valid of ${boot.requested} bootstrap samples (seed ${boot.seed}); p is from the t distribution with B − 1 degrees of freedom.`
                    : 'No bootstrap was run.'}
                </p>
                <p className="rs-note-small">
                  Full method statement: <code>docs/estimators/pls-csem.md</code> in the SEM Studio
                  repository (exact cSEM call, bootstrap procedure, definitions).
                </p>
                <ExportRButton run={run} projectName={projectName} />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

function StyleControls() {
  const s = useResultStyle();
  return (
    <div className="rs-style" role="group" aria-label="Table presentation">
      <SegmentedControl
        aria-label="Decimal places"
        size="small"
        value={String(s.decimals) as '2' | '3'}
        onChange={(v) => s.set({ decimals: Number(v) as 2 | 3 })}
        options={[
          { value: '2', label: '2 decimals' },
          { value: '3', label: '3 decimals' },
        ]}
      />
      <Switch
        label="APA style (no leading zero)"
        checked={s.apa}
        onChange={(e) => s.set({ apa: e.target.checked })}
      />
    </div>
  );
}

export function ResultsPage() {
  useProjectData();
  const { runs, current } = useProjectRuns();
  const selectedId = useRuns((s) => s.selectedRunId);
  const complete = useMemo(() => runs.filter((r) => r.record.status === 'complete'), [runs]);
  const run = complete.find((r) => r.runId === selectedId) ?? current ?? complete[0] ?? null;

  return (
    <>
      <PageHeader
        title="Results"
        description="Tables, bootstrap distributions and provenance of a finished run. Tables copy into Word as editable tables."
      />
      {!run ? (
        <EmptyState icon={<FlaskConical size={24} />} title="No results yet">
          <p>Run an analysis to see results here. Finished runs are kept in this browser.</p>
          <Link to="/analysis">Go to Analysis</Link>
        </EmptyState>
      ) : (
        <div className="rs-page">
          <div className="rs-bar">
            <Field label="Run">
              {(p) => (
                <Select
                  {...p}
                  value={run.runId}
                  onChange={(e) => useRuns.getState().select(e.target.value)}
                >
                  {complete.map((r) => (
                    <option key={r.runId} value={r.runId}>
                      {new Date(r.createdAt).toLocaleString('en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      · {METHOD_TEXT[r.record.method]}
                      {r.staleness !== 'current' ? ` · ${STALE_LABEL[r.staleness]}` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <StyleControls />
          </div>
          {run.staleness !== 'current' ? (
            <Callout variant="warning" title="Historical run">
              This run is {STALE_LABEL[run.staleness]}. It describes the model and data as they were
              when it ran, not the current ones.
            </Callout>
          ) : null}
          <ResultBody run={run} />
        </div>
      )}
    </>
  );
}
