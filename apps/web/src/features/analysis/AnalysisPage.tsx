import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { modelHash as hashModel } from '@sem-studio/contracts';
import { ClipboardCheck, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Callout, PageHeader } from '@/components/ui';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import { type ValidationIssue, hasBlockingIssues, validate } from '@/domain/validation/validate';
import { ValidationList } from '@/features/data-lab/ValidationList';
import { dataSummary, summarize } from '@/features/data-lab/readiness';
import { linkStateOf, useDataLab } from '@/features/data-lab/store';
import { useProjectData } from '@/features/data-lab/useProjectData';
import { useModeler } from '@/features/modeler/store';
import { API_BASE_URL, ApiError, api } from './api';
import { ConfigPanel } from './ConfigPanel';
import { engineHealth, toConfiguration, useAnalysisConfig } from './config';
import { findResumable, useJobs } from './jobs';
import { RemoteDialog, hostOf } from './RemoteDialog';
import { RunHistory } from './RunHistory';
import { RunFailure, RunProgress } from './RunStatus';
import { useProjectRuns } from './runs';
import './analysis.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function useHealth() {
  return useQuery({
    queryKey: ['analysis-health', API_BASE_URL],
    queryFn: () => api.health(),
    enabled: API_BASE_URL !== null,
  });
}

function AnalysisInner() {
  useProjectData();
  const navigate = useNavigate();
  const model = useModeler((s) => s.model);
  const projectId = useModeler((s) => s.projectId);
  const datasetRef = useModeler((s) => s.datasetRef);
  const dataset = useDataLab((s) => s.dataset);
  const profiles = useDataLab((s) => s.profiles);
  const { config, set } = useAnalysisConfig();
  const health = useHealth();
  const { runs } = useProjectRuns();
  const active = useJobs((s) => s.active);
  const outcome = useJobs((s) => s.outcome);
  const remoteConfirmed = useJobs((s) => s.remoteConfirmed);
  const [dialog, setDialog] = useState(false);
  const [validated, setValidated] = useState(false);

  const limits = health.data?.limits;
  const parsed = useMemo(() => toConfiguration(config, limits?.maxBootstrapReps), [config, limits]);
  const data = useMemo(
    () => (dataset ? buildAnalysisData(model, dataset, 'listwise') : null),
    [model, dataset],
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
  const unavailable = API_BASE_URL === null;
  const engine = health.data ? engineHealth(health.data, 'r-csem') : undefined;
  const engineDown = engine !== undefined && !engine.available;
  const disabled = blocked || unavailable || engineDown || active !== null;

  // A job left running by a reload is picked up again.
  useEffect(() => {
    if (active || unavailable) return;
    void findResumable(projectId).then((r) => r && useJobs.getState().resume(r));
  }, [projectId, active, unavailable, runs.length]);

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
    if (disabled) return;
    if (!remoteConfirmed) setDialog(true);
    else void run();
  };

  return (
    <>
      <PageHeader
        title="Analysis"
        description="Configure the estimation, check readiness, run it on the analysis service and open the results."
      />
      <div className="an-page">
        <div className="an-col an-col--config">
          <ConfigPanel
            config={config}
            problems={parsed.ok ? {} : parsed.problems}
            onChange={set}
            maxBootstrap={limits?.maxBootstrapReps ?? null}
          />
          <div className="an-actions-bar">
            <Button variant="primary" icon={<Play size={16} />} disabled={disabled} onClick={onRun}>
              Run analysis
            </Button>
            <Button icon={<ClipboardCheck size={16} />} onClick={() => setValidated(true)}>
              Validate model
            </Button>
          </div>
          {blocked && !unavailable ? (
            <p className="an-note">Run analysis is disabled while an error remains.</p>
          ) : null}
        </div>

        <div className="an-col">
          <ServiceStatus health={health} unavailable={unavailable} />
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
                Missing data: listwise deletion. {matrix.nUsed.toLocaleString('en')} of{' '}
                {matrix.nRows.toLocaleString('en')} rows will be used
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
          {!unavailable ? (
            <p className="an-privacy">
              Data leaves browser for computation: only the mapped indicator columns are sent, after
              you confirm.
            </p>
          ) : null}
          {active ? (
            <RunProgress active={active} onCancel={() => void useJobs.getState().cancel()} />
          ) : null}
          {outcome && outcome.status !== 'complete' ? (
            <RunFailure outcome={outcome} onDismiss={() => useJobs.getState().clearOutcome()} />
          ) : null}
          <RunHistory runs={runs} activeRunId={active?.runId || null} />
        </div>
      </div>
      <RemoteDialog
        open={dialog}
        host={hostOf(API_BASE_URL)}
        nRows={matrix?.nUsed ?? 0}
        nColumns={matrix?.columns.length ?? 0}
        retentionHours={limits?.dataRetentionHours ?? null}
        onCancel={() => setDialog(false)}
        onConfirm={() => {
          useJobs.getState().confirmRemote();
          setDialog(false);
          void run();
        }}
      />
    </>
  );
}

function ServiceStatus({
  health,
  unavailable,
}: {
  health: ReturnType<typeof useHealth>;
  unavailable: boolean;
}) {
  if (unavailable)
    return (
      <Callout variant="info" title="No analysis service is configured for this build">
        Modeling, data preparation and validation work offline. Running an analysis needs a service
        that runs R; this build of SEM Studio was made without one.
      </Callout>
    );
  if (health.isPending) return <p className="an-note">Checking the analysis service…</p>;
  if (health.isError) {
    const e = health.error;
    return (
      <Callout variant="error" title="The analysis service is not reachable">
        {e instanceof ApiError ? e.message : 'The analysis service could not be reached.'}
      </Callout>
    );
  }
  const eng = engineHealth(health.data, 'r-csem');
  return eng?.available ? (
    <p className="an-note" role="status">
      Analysis service reachable. Engine r-csem available
      {eng.version ? ` (cSEM ${eng.version})` : ''}.
    </p>
  ) : (
    <Callout variant="warning" title="The r-csem engine is not available on the service">
      {eng?.reason ?? 'The service did not report an r-csem engine.'}
    </Callout>
  );
}

export function AnalysisPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <AnalysisInner />
    </QueryClientProvider>
  );
}
