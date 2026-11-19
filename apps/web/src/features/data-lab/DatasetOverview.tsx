import { Link } from 'react-router-dom';
import { Database } from 'lucide-react';
import { Badge, Button, Callout, Card, CardHeader, KpiGrid, KpiTile } from '@/components/ui';
import { bundledDatasetInfo, CC_BY_4_URL } from '@/domain/dataset/bundled';
import { useModeler } from '@/features/modeler/store';
import { fmt, pct, plural } from './format';
import { mappedColumns } from './readiness';
import { missingness } from '@/domain/dataset/stats';
import { linkStateOf, useDataLab } from './store';
import { useMemo } from 'react';

/** Where the project's data stands: stored here, missing, or different from what was imported. */
export function LinkBanner() {
  const ref = useModeler((s) => s.datasetRef);
  const dataset = useDataLab((s) => s.dataset);
  const status = useDataLab((s) => s.status);
  const linkToProject = useDataLab((s) => s.linkToProject);
  const state = linkStateOf(ref, dataset);

  if (state === 'missing' && status === 'loading') return null;
  if (state === 'missing' && ref) {
    return (
      <Callout variant="warning" title="This project's data is not stored in this browser">
        This project's data (fingerprint {ref.fingerprint.slice(0, 12)}…,{' '}
        {plural(ref.rowCount, 'row')}) is not stored in this browser — import the same file again.
        SEM Lab checks the fingerprint after import and tells you if the file differs.
      </Callout>
    );
  }
  if (state === 'mismatch' && ref && dataset) {
    return (
      <Callout variant="error" title="These data differ from the data this project was built on">
        The project expects fingerprint {ref.fingerprint.slice(0, 12)}… (
        {plural(ref.rowCount, 'row')}
        ); the data you imported have fingerprint {dataset.fingerprint.slice(0, 12)}… (
        {plural(dataset.rowIndex.length, 'row')}). Results would not be comparable with earlier
        work. Import the original file again, or accept the new data for this project.
        <div className="dl-callout-actions">
          <Button size="small" onClick={linkToProject}>
            Link these data to the project
          </Button>
        </div>
      </Callout>
    );
  }
  if (state === 'unlinked' && dataset) {
    return (
      <Callout variant="info" title="These data are not linked to the open project">
        The open project does not point at any dataset yet.
        <div className="dl-callout-actions">
          <Button size="small" onClick={linkToProject}>
            Link these data to the project
          </Button>
        </div>
      </Callout>
    );
  }
  if (state === 'verified' && ref) {
    return (
      <p className="dl-muted dl-verified">
        <Badge variant="success">Matches project</Badge> Fingerprint {ref.fingerprint.slice(0, 12)}…
        agrees with the data link saved in the project.
      </p>
    );
  }
  return null;
}

export function DatasetHeader() {
  const dataset = useDataLab((s) => s.dataset);
  if (!dataset) return null;
  const info =
    dataset.source.kind === 'bundled' ? bundledDatasetInfo(dataset.source.exampleId) : undefined;
  const rows = dataset.rowIndex.length;
  return (
    <Card className="dl-card" aria-labelledby="dl-dataset-h">
      <CardHeader
        level={2}
        icon={<Database size={18} />}
        title={<span id="dl-dataset-h">{dataset.name}</span>}
        action={
          <span className="dl-badges">
            {info?.synthetic ? <Badge variant="accent">SYNTHETIC</Badge> : null}
            {info && !info.synthetic && info.provenance.licence ? (
              <Badge variant="info">
                <a href={info.licenceUrl ?? CC_BY_4_URL} target="_blank" rel="noreferrer">
                  {info.provenance.licence}
                </a>
              </Badge>
            ) : null}
            {dataset.source.kind === 'file' ? <Badge>Your file</Badge> : null}
          </span>
        }
      />
      <p className="dl-muted">
        {plural(rows, 'row')} × {plural(dataset.columns.length, 'column')} ·{' '}
        {dataset.source.kind === 'file'
          ? `from ${dataset.source.fileName}`
          : 'bundled sample dataset'}{' '}
        · fingerprint <code title={dataset.fingerprint}>{dataset.fingerprint.slice(0, 12)}…</code>
      </p>
      <p className="dl-muted">
        The data stay in this browser. The original file is never modified: every transformation
        below creates a new working table from the unchanged original and is recorded in a log you
        can undo.
      </p>
      {info?.synthetic ? <p className="dl-muted">{info.provenance.attribution}</p> : null}
      {info && !info.synthetic ? (
        <p className="dl-muted">Attribution: {info.provenance.attribution}</p>
      ) : null}
      <LinkBanner />
    </Card>
  );
}

export function QualitySummary() {
  const dataset = useDataLab((s) => s.dataset);
  const profiles = useDataLab((s) => s.profiles);
  const model = useModeler((s) => s.model);
  const complete = useMemo(() => {
    if (!dataset) return null;
    const cols = mappedColumns(model, dataset);
    return cols.length > 0 ? missingness(dataset, cols).completeRows : null;
  }, [dataset, model]);
  if (!dataset) return null;
  const rows = dataset.rowIndex.length;
  const count = (k: string) => profiles.filter((p) => p.kind === k).length;
  const missingCells = profiles.reduce((a, p) => a + p.nMissing, 0);
  const mappedCount = mappedColumns(model, dataset).length;
  return (
    <section aria-labelledby="dl-quality-h" className="dl-section">
      <h2 id="dl-quality-h" className="dl-h2">
        Data quality
      </h2>
      <KpiGrid className="dl-quality-kpis">
        <KpiTile
          label="Observations"
          value={rows.toLocaleString('en-US')}
          detail="rows in the working table"
        />
        <KpiTile label="Columns" value={dataset.columns.length} />
        <KpiTile label="Numeric columns" value={count('numeric')} />
        <KpiTile label="Text columns" value={count('text')} detail="not usable as indicators" />
        <KpiTile label="Empty columns" value={count('empty')} />
        <KpiTile
          label="Missing cells"
          value={missingCells.toLocaleString('en-US')}
          detail={`${pct(missingCells, rows * dataset.columns.length)} of all cells`}
        />
        <KpiTile
          label="Complete rows (model columns)"
          value={complete === null ? '–' : complete.toLocaleString('en-US')}
          detail={
            complete === null
              ? 'map indicators to columns first'
              : `${fmt((100 * complete) / Math.max(rows, 1), 1)}% of rows · ${plural(mappedCount, 'column')}`
          }
        />
      </KpiGrid>
      {rows === 0 ? <Callout variant="warning">The working table has no rows left.</Callout> : null}
    </section>
  );
}

export function EmptyDataHint() {
  const dataset = useDataLab((s) => s.dataset);
  const status = useDataLab((s) => s.status);
  if (dataset || status === 'loading') return null;
  return (
    <p className="dl-muted">
      No data loaded. Import a CSV or open a sample dataset to see previews, diagnostics and the
      column mapping. Looking for a model first? <Link to="/modeler">Open the Modeler</Link>.
    </p>
  );
}
