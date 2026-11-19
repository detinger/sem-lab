import { modelHash as hashModel } from '@sem-lab/contracts';
import { ClipboardCheck, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, PageHeader } from '@/components/ui';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { type ValidationIssue, hasBlockingIssues, validate } from '@/domain/validation/validate';
import { ValidationList } from '@/features/data-lab/ValidationList';
import { dataSummary, summarize } from '@/features/data-lab/readiness';
import { linkStateOf, useDataLab } from '@/features/data-lab/store';
import { useProjectData } from '@/features/data-lab/useProjectData';
import { useModeler } from '@/features/modeler/store';
import { ConfigPanel } from './ConfigPanel';
import { PRIVACY_LINE, toConfiguration, useAnalysisConfig } from './config';
import { useJobs } from './jobs';
import { RunHistory } from './RunHistory';
import { RunFailure, RunProgress } from './RunStatus';
import { useProjectRuns } from './runs';
import './analysis.css';

function AnalysisInner() {
  useProjectData();
  const navigate = useNavigate();
  const model = useModeler((s) => s.model);
  const projectId = useModeler((s) => s.projectId);
  const datasetRef = useModeler((s) => s.datasetRef);
  const dataset = useDataLab((s) => s.dataset);
  const profiles = useDataLab((s) => s.profiles);
  const { config, set } = useAnalysisConfig();
  const { runs } = useProjectRuns();
  const active = useJobs((s) => s.active);
  const outcome = useJobs((s) => s.outcome);
  const [validated, setValidated] = useState(false);

  const parsed = useMemo(() => toConfiguration(config), [config]);
  const missing = config.method === 'cb-sem' && config.cbMissing === 'fiml' ? 'fiml' : 'listwise';
  const data = useMemo(
    () => (dataset ? buildAnalysisData(model, dataset, missing) : null),
    [model, dataset, missing],
  );
  const link = linkStateOf(datasetRef, dataset);

  const issues = useMemo<ValidationIssue[]>(() => {
    const out = validate({
      model,
      ...(parsed.ok ? { analysis: parsed.analysis } : { method: config.method }),
      ...(dataset ? { data: dataSummary(model, dataset, profiles) } : {}),
    });
    const extra = (code: string, title: string, explanation: string, fixes: string[]): void => {
      out.unshift({
        code,
        severity: 'error',
        layer: 'data',
        title,
        explanation,
        fixes,
        elementIds: [],
      });
    };
    if (!dataset)
      extra('NO_DATA', 'No data are loaded', 'An analysis needs the data the model is mapped to.', [
        'Import a CSV file or open a sample dataset in the Data Lab.',
      ]);
    else if (link === 'mismatch')
      extra(
        'DATA_LINK_MISMATCH',
        'The loaded data are not the data this project was linked to',
        'Results would be bound to different data than the project records.',
        ['Import the original data, or link the loaded data in the Data Lab.'],
      );
    else if (data && 'error' in data && !out.some((i) => i.code === data.error.code))
      extra(data.error.code, data.error.message, 'The analysis matrix cannot be built.', [
        'Fix the mapping or the data in the Data Lab.',
      ]);
    return out;
  }, [model, parsed, config.method, dataset, profiles, link, data]);

  const blocked = hasBlockingIssues(issues) || !parsed.ok;
  const counts = summarize(issues);
  const matrix = data && !('error' in data) ? data : null;
  const disabled = blocked || active !== null;

  useEffect(() => {
    if (outcome?.status === 'complete') {
      useJobs.getState().clearOutcome();
      void navigate('/results');
    }
  }, [outcome, navigate]);

  const run = async (): Promise<void> => {
    if (!parsed.ok || !matrix || !dataset) return;
    if (!datasetRef) useDataLab.getState().linkToProject();
    const m = useModeler.getState().model;
    await useJobs.getState().start({
      projectId,
      model: m,
      analysis: parsed.analysis,
      data: matrix,
      modelHash: await hashModel(m),
      dataFingerprint: dataset.fingerprint,
    });
  };

  const onRun = (): void => {
    if (!disabled) void run();
  };

  return (
    <>
      <PageHeader
        title="Analysis"
        description="Configure the estimation, check readiness, run it in this browser and open the results."
      />
      <div className="an-page">
        <div className="an-col an-col--config">
          <ConfigPanel config={config} problems={parsed.ok ? {} : parsed.problems} onChange={set} />
          <div className="an-actions-bar">
            <Button variant="primary" icon={<Play size={16} />} disabled={disabled} onClick={onRun}>
              Run analysis
            </Button>
            <Button icon={<ClipboardCheck size={16} />} onClick={() => setValidated(true)}>
              Validate model
            </Button>
          </div>
          {blocked ? (
            <p className="an-note">Run analysis is disabled while an error remains.</p>
          ) : null}
        </div>

        <div className="an-col">
          <section className="an-card" aria-labelledby="an-ready">
            <h2 id="an-ready" className="an-h2">
              Readiness
            </h2>
            <p className="an-note" role="status">
              {validated ? 'Validated just now: ' : ''}
              {counts.error} errors · {counts.warning} warnings · {counts.recommendation}{' '}
              recommendations
            </p>
            {matrix ? (
              <p className="an-note">
                Missing data: {matrix.missingData === 'fiml' ? 'FIML' : 'listwise deletion'}.{' '}
                {matrix.nUsed.toLocaleString('en')} of {matrix.nRows.toLocaleString('en')} rows will
                be used
                {matrix.nDropped > 0 ? ` (${matrix.nDropped.toLocaleString('en')} removed)` : ''}.
              </p>
            ) : null}
            <ValidationList
              issues={issues}
              emptyTitle="No issues found"
              focusLabel="Show in Data mapping"
              onFocus={(ids) => {
                // Take the user to the exact mapping field(s) on the Data page.
                useModeler.getState().select(ids);
                void navigate('/data');
                window.setTimeout(() => {
                  const row = document.getElementById(`map-ind-${ids[0]}`);
                  if (row) {
                    row.scrollIntoView({ block: 'center' });
                    row.querySelector<HTMLElement>('select, input')?.focus();
                  } else document.getElementById('dl-mapping')?.scrollIntoView({ block: 'start' });
                }, 250);
              }}
            />
          </section>
          <p className="an-privacy">{PRIVACY_LINE}</p>
          {active ? (
            <RunProgress active={active} onCancel={() => void useJobs.getState().cancel()} />
          ) : null}
          {outcome && outcome.status !== 'complete' ? (
            <RunFailure outcome={outcome} onDismiss={() => useJobs.getState().clearOutcome()} />
          ) : null}
          <RunHistory runs={runs} />
        </div>
      </div>
    </>
  );
}

export function AnalysisPage() {
  return <AnalysisInner />;
}
