import { isOffered, unavailableReason } from '@sem-lab/method-registry';
import type { NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import { ChartScatter, ClipboardCopy, Download, FlaskConical, Route } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  Callout,
  EmptyState,
  Menu,
  PageHeader,
  SegmentedControl,
  Switch,
  Table,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { ENGINE } from '@/features/analysis/config';
import { STALE_LABEL, type RunView, useProjectRuns } from '@/features/analysis/runs';
import { useProjectData } from '@/features/data-lab/useProjectData';
import { useFocusRequest } from '@/features/modeler/focus';
import { svgToPng } from '@/features/modeler/export/svg-export';
import { useModeler } from '@/features/modeler/store';
import { copyTable } from '../reports/clipboard';
import { formatNumber } from '../reports/format';
import { toCsv } from '../reports/table';
import { download } from '../results/ExportR';
import {
  type IpmaPoint,
  type Level,
  type Scope,
  boundsSummary,
  buildPoints,
  constructName,
  decompose,
  itemBounds,
  missingEndpoints,
  supportingIds,
  targetLabel,
} from './data';
import { type ExportPreset, PRESET_LABELS, ipmaSvg } from './export';
import { IpmaChart } from './IpmaChart';
import { median } from 'd3-array';
import {
  FOOTNOTE,
  INTERPRETATION_CARD,
  MISSING_ENDPOINTS_CALLOUT,
  NO_INTERVAL_NOTE,
  interpretationText,
  ipmaTable,
  pointSummary,
  predecessorText,
} from './text';
import './ipma.css';

const f3 = (v: number): string => formatNumber(v, { decimals: 3 });
const f1 = (v: number): string => formatNumber(v, { decimals: 1 });
const METHOD_TEXT = { 'pls-sem': 'PLS-SEM', plsc: 'PLSc', 'cb-sem': 'CB-SEM' } as const;

function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ sidebar

function Sidebar({
  point,
  model,
  result,
  target,
  targetName,
  onView,
}: {
  point: IpmaPoint | null;
  model: SemModel;
  result: NormalizedSemResult;
  target: string;
  targetName: string;
  onView: () => void;
}) {
  if (!point)
    return (
      <aside className="ipma-side" aria-label="Selected construct">
        <h2 className="ipma-side__h">Selected construct</h2>
        <p className="ipma-muted">
          Select a point on the map to see its importance, performance and the paths behind it.
        </p>
        <InterpretationCard />
      </aside>
    );
  const d = decompose(model, result, point.constructId, target);
  const bounds = itemBounds(model, point.constructId);
  const matches = d.total !== null && Math.abs(d.total - point.importance) < 5e-4;
  const owner = constructName(model, point.constructId);
  return (
    <aside className="ipma-side" aria-label="Selected construct">
      <h2 className="ipma-side__h">Selected {point.kind}</h2>
      <p className="ipma-side__name">{point.label}</p>
      {point.description ? <p className="ipma-muted">{point.description}</p> : null}
      <dl className="ipma-dl">
        <dt>Importance (total effect)</dt>
        <dd data-testid="side-importance">{f3(point.importance)}</dd>
        <dt>Performance</dt>
        <dd data-testid="side-performance">{f1(point.performance)} / 100</dd>
        <dt>Relation to target</dt>
        <dd>{predecessorText(point.predecessor)}</dd>
        <dt>Rank by importance</dt>
        <dd>{point.rank}</dd>
      </dl>

      <h3 className="ipma-side__sub">Path decomposition</h3>
      <p className="ipma-muted">
        {point.kind === 'indicator' ? `Routes of ${owner} to ${targetName}. ` : ''}
        Standardized path coefficients along each directed route; the total effect is the sum of the
        route products.
      </p>
      {d.routes.length === 0 ? (
        <p className="ipma-muted">No directed route from {owner} to the target.</p>
      ) : (
        <ul className="ipma-routes">
          {d.routes.map((r) => (
            <li key={r.nodes.join('>')}>
              <span className="ipma-route__nodes">
                {r.nodes.map((n) => constructName(model, n)).join(' → ')}
              </span>
              <span className="ipma-route__calc">
                {r.coefficients.map((c) => (c === null ? '—' : f3(c))).join(' × ')} ={' '}
                <strong>{r.product === null ? 'not estimated' : f3(r.product)}</strong>
              </span>
            </li>
          ))}
          <li className="ipma-route--sum">
            <span className="ipma-route__nodes">Sum of routes (standardized total effect)</span>
            <span className="ipma-route__calc">
              <strong data-testid="side-total">{d.total === null ? '—' : f3(d.total)}</strong>
            </span>
          </li>
        </ul>
      )}
      {d.total !== null && !matches ? (
        <p className="ipma-muted">
          IPMA importance ({f3(point.importance)}) is the total effect on the rescaled 0–100 scores,
          so it can differ from the standardized sum above by the ratio of the constructs' standard
          deviations.
        </p>
      ) : null}

      <h3 className="ipma-side__sub">Original item bounds</h3>
      <p className="ipma-muted">{boundsSummary(bounds)}</p>
      <ul className="ipma-bounds">
        {bounds.map((b) => (
          <li key={b.id}>
            <code>{b.name}</code>
            <span>{b.min === null || b.max === null ? 'not set' : `${b.min}–${b.max}`}</span>
          </li>
        ))}
      </ul>

      <InterpretationCard />
      <Button icon={<Route size={14} />} onClick={onView}>
        View supporting paths
      </Button>
    </aside>
  );
}

function InterpretationCard() {
  return (
    <div className="ipma-interp">
      <p className="ipma-interp__h">How to read this</p>
      <p>{INTERPRETATION_CARD}</p>
    </div>
  );
}

// ------------------------------------------------------------------ ready view

function IpmaReady({ run }: { run: RunView }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const model = run.model;
  const result = run.record.result!;
  const ipma = result.ipma!;
  const hasIndicators = (ipma.indicators?.length ?? 0) > 0;
  const [level, setLevel] = useState<Level>('constructs');
  const [scope, setScope] = useState<Scope>('all');
  const [medians, setMedians] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const target = ipma.targetConstructId;
  const targetName = constructName(model, target);
  const points = useMemo(
    () => buildPoints(model, ipma, hasIndicators ? level : 'constructs', scope),
    [model, ipma, level, scope, hasIndicators],
  );
  const colorIndex = useMemo(
    () => new Map(model.constructs.map((c, i) => [c.id, i] as const)),
    [model],
  );
  const effectiveLevel: Level = hasIndicators ? level : 'constructs';

  // Reverse link: a construct selected in the Modeler selects its point here. Derived, not an
  // effect: the Modeler's selection wins whenever it names a different construct than the pick.
  const modelerSelection = useModeler((s) => s.selection);
  const picked = points.find((p) => p.id === selectedId) ?? null;
  const fromModeler =
    modelerSelection.length === 1
      ? (points.find((p) => p.id === modelerSelection[0]) ??
        points.find((p) => p.constructId === modelerSelection[0]) ??
        null)
      : null;
  const selected =
    fromModeler && fromModeler.constructId !== picked?.constructId ? fromModeler : picked;

  const select = (id: string): void => {
    setSelectedId(id);
    const p = points.find((q) => q.id === id);
    if (p) useModeler.getState().select([p.constructId]);
  };

  const scopeText = scope === 'direct' ? 'direct predecessors' : 'all predecessors';
  const medXY = {
    x: median(points, (p) => p.performance),
    y: median(points, (p) => p.importance),
  };
  const table = useMemo(
    () =>
      ipmaTable(points, {
        targetName,
        level: effectiveLevel,
        scopeText,
        convention: ipma.convention,
      }),
    [points, targetName, effectiveLevel, scopeText, ipma.convention],
  );
  const cs = result.provenance.packageVersions['cSEM'];
  const methodLine = `${METHOD_TEXT[run.record.method]}${cs ? ` (cSEM ${cs})` : ''}, N = ${result.sample.nUsed}, target ${targetName}.`;

  const toastCopy = async (text: string, ok: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: ok, variant: 'success' });
    } catch {
      toast({ title: 'Copying is not available in this browser context.', variant: 'error' });
    }
  };

  const exportFigure = async (kind: 'svg' | 'svg-transparent' | ExportPreset): Promise<void> => {
    const preset: ExportPreset = kind === 'svg' || kind === 'svg-transparent' ? 'widescreen' : kind;
    const svg = ipmaSvg({
      points,
      colorIndex,
      constructNames: new Map(model.constructs.map((c) => [c.id, c.name] as const)),
      targetName,
      methodLine,
      preset,
      background: kind === 'svg-transparent' ? 'transparent' : 'white',
      medians,
    });
    const base = `ipma-${targetName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    if (kind === 'svg' || kind === 'svg-transparent') {
      saveBlob(
        `${base}${kind === 'svg' ? '' : '-transparent'}.svg`,
        new Blob([svg], { type: 'image/svg+xml' }),
      );
      return;
    }
    try {
      saveBlob(`${base}-${kind}.png`, await svgToPng(svg, 1));
    } catch (e) {
      toast({
        title: 'PNG export failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'error',
      });
    }
  };

  const card = (p: IpmaPoint) => (
    <>
      <p className="ipma-card__name">{p.label}</p>
      <dl className="ipma-card__dl">
        <dt>Importance</dt>
        <dd>{f3(p.importance)}</dd>
        <dt>Performance</dt>
        <dd>{f1(p.performance)} / 100</dd>
        <dt>Target</dt>
        <dd>{targetName}</dd>
        <dt>Item scales</dt>
        <dd>{boundsSummary(itemBounds(model, p.constructId))}</dd>
        <dt>Relation</dt>
        <dd>{predecessorText(p.predecessor)}</dd>
      </dl>
      <p className="ipma-card__note">{NO_INTERVAL_NOTE}</p>
    </>
  );

  return (
    <div className="ipma-page">
      <div className="ipma-bar">
        <p className="ipma-target">
          <span className="ipma-target__k">Target</span>
          <strong data-testid="ipma-target">{targetLabel(model, target)}</strong>
          <Link to="/analysis" className="ipma-target__link">
            Change in Analysis
          </Link>
        </p>
        <div className="ipma-controls">
          <SegmentedControl
            aria-label="Level"
            size="small"
            value={effectiveLevel}
            onChange={setLevel}
            options={[
              { value: 'constructs', label: 'Constructs' },
              ...(hasIndicators ? [{ value: 'indicators' as const, label: 'Indicators' }] : []),
            ]}
          />
          <SegmentedControl
            aria-label="Predecessors"
            size="small"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All predecessors' },
              { value: 'direct', label: 'Direct predecessors' },
            ]}
          />
          <Menu
            label="Export"
            icon={<Download size={14} />}
            size="small"
            align="end"
            items={[
              {
                id: 'svg',
                label: 'SVG, white background',
                onSelect: () => void exportFigure('svg'),
              },
              {
                id: 'svg-t',
                label: 'SVG, transparent background',
                onSelect: () => void exportFigure('svg-transparent'),
              },
              ...(['widescreen', 'square', 'academic'] as const).map((p) => ({
                id: p,
                label: `PNG ${PRESET_LABELS[p]}`,
                onSelect: () => void exportFigure(p),
              })),
              {
                id: 'table',
                label: 'Copy IPMA data table',
                onSelect: () =>
                  void copyTable(table).then((o) =>
                    toast({
                      title: o.message,
                      variant:
                        o.kind === 'rich' ? 'success' : o.kind === 'text' ? 'warning' : 'error',
                    }),
                  ),
              },
              {
                id: 'text',
                label: 'Copy interpretation text',
                onSelect: () =>
                  void toastCopy(
                    interpretationText(points, { targetName, level: effectiveLevel }),
                    'Interpretation copied',
                  ),
              },
            ]}
          />
        </div>
      </div>
      {result.warnings
        .filter((w) => w.code.startsWith('IPMA_'))
        .map((w) => (
          <Callout key={w.code} variant="info" title="Engine note">
            {w.message}
          </Callout>
        ))}
      <p className="ipma-purpose">
        Importance is the total effect of each{' '}
        {effectiveLevel === 'indicators' ? 'indicator’s construct' : 'construct'} on {targetName};
        performance is a 0–100 score from the original survey scale endpoints.{' '}
      </p>

      <details className="ipma-details">
        <summary>Scaling and estimator details</summary>
        <p className="ipma-muted">{ipma.convention}</p>
      </details>

      <div className="ipma-main">
        <section className="ipma-plot" aria-label="Importance-performance map">
          <IpmaChart
            points={points}
            colorIndex={colorIndex}
            targetName={targetName}
            selectedId={selected?.id ?? null}
            onSelect={select}
            medians={medians}
            renderCard={card}
          />
          <div className="ipma-legend" aria-label="Legend">
            <ul className="ipma-legend__colors">
              {[...new Set(points.map((p) => p.constructId))].map((id) => (
                <li key={id}>
                  <span
                    className="ipma-swatch"
                    data-c={(colorIndex.get(id) ?? 0) % 8}
                    aria-hidden="true"
                  />
                  {constructName(model, id)}
                </li>
              ))}
            </ul>
            <ul className="ipma-legend__shapes">
              <li>
                <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                  <circle r="5.5" className="ipma-legend__shape" />
                </svg>
                Direct predecessor (circle)
              </li>
              <li>
                <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                  <path d="M0,-7L7,0L0,7L-7,0z" className="ipma-legend__shape" />
                </svg>
                Indirect predecessor (diamond)
              </li>
              {medians && medXY.x !== undefined && medXY.y !== undefined ? (
                <li>
                  <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
                    <line x1="1" x2="21" y1="8" y2="8" className="ipma-legend__dots" />
                  </svg>
                  Median of displayed{' '}
                  {effectiveLevel === 'indicators' ? 'indicators' : 'constructs'} (performance{' '}
                  {f1(medXY.x)}, importance {f3(medXY.y)})
                </li>
              ) : null}
            </ul>
          </div>
          <div className="ipma-plot__foot">
            <Switch
              label="Show reference lines"
              checked={medians}
              onChange={(e) => setMedians(e.target.checked)}
            />
            <p className="ipma-note">{FOOTNOTE}</p>
          </div>
        </section>
        <Sidebar
          point={selected}
          model={model}
          result={result}
          target={target}
          targetName={targetName}
          onView={() => {
            if (!selected) return;
            useFocusRequest
              .getState()
              .focus(
                supportingIds(model, result, selected, target),
                `IPMA: supporting paths of ${selected.label} to ${targetName}`,
              );
            void navigate('/modeler');
          }}
        />
      </div>
      <p className="sr-only" aria-live="polite" data-testid="ipma-live">
        {selected ? pointSummary(selected, targetName) : ''}
      </p>

      <section className="ipma-table-card" aria-label="IPMA data section">
        <div className="ipma-table-head">
          <h2 className="ipma-side__h">IPMA data</h2>
          <div className="ipma-table-tools">
            <Button
              size="small"
              icon={<ClipboardCopy size={14} />}
              onClick={() =>
                void copyTable(table).then((o) =>
                  toast({
                    title: o.message,
                    variant:
                      o.kind === 'rich' ? 'success' : o.kind === 'text' ? 'warning' : 'error',
                  }),
                )
              }
            >
              Copy table
            </Button>
            <Button
              size="small"
              icon={<Download size={14} />}
              onClick={() => download('ipma-table.csv', toCsv(table), 'text/csv;charset=utf-8')}
            >
              CSV
            </Button>
          </div>
        </div>
        <Table aria-label="IPMA data" className="ipma-table">
          <thead>
            <tr>
              {table.columns.map((c) => (
                <Th key={c.key} numeric={c.numeric}>
                  {c.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr
                key={points[i]!.id}
                data-selected={points[i]!.id === selected?.id || undefined}
                onClick={() => select(points[i]!.id)}
              >
                {table.columns.map((c) => (
                  <Td key={c.key} numeric={c.numeric}>
                    {r[c.key]}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="ipma-note">{FOOTNOTE}</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ page

export function IpmaPage() {
  useProjectData();
  useEffect(() => {
    if (import.meta.env.DEV) void import('./devHook').then((m) => m.registerDevHook());
  }, []);
  const { runs, current } = useProjectRuns();
  const model = useModeler((s) => s.model);
  const complete = runs.filter((r) => r.record.status === 'complete');
  const offered = isOffered('ipma.construct', ENGINE);
  const reason = unavailableReason('ipma.construct', ENGINE);

  let body;
  if (complete.length === 0) {
    body = (
      <EmptyState icon={<FlaskConical size={24} />} title="No results yet">
        <p>Run an analysis with an IPMA target to see the importance-performance map.</p>
        <Link to="/analysis">Go to Analysis</Link>
      </EmptyState>
    );
  } else if (!current) {
    const latest = complete[0]!;
    body = (
      <EmptyState icon={<FlaskConical size={24} />} title="The latest run is historical">
        <p>
          The latest run is{' '}
          {latest.staleness === 'current' ? 'current' : STALE_LABEL[latest.staleness]}. IPMA
          describes the current model, so run the analysis again.
        </p>
        <Link to="/analysis">Go to Analysis</Link>
      </EmptyState>
    );
  } else if (!current.record.result?.ipma) {
    const missing = missingEndpoints(model).length > 0;
    body = (
      <div className="ipma-empty">
        {missing ? (
          <Callout variant="error" title={MISSING_ENDPOINTS_CALLOUT}>
            IPMA performance rescales each item to 0–100 using the original scale endpoints;
            observed minima and maxima are never used.{' '}
            <Link to="/data">Open the Data page mapping section</Link>
          </Callout>
        ) : null}
        {!offered ? (
          <Callout variant="info" title="IPMA is not offered yet">
            {reason ?? 'The analysis engine does not offer IPMA.'}
          </Callout>
        ) : null}
        <EmptyState icon={<ChartScatter size={24} />} title="This run has no IPMA">
          <p>Choose an IPMA target in Analysis and run again.</p>
          <Link to="/analysis">Go to Analysis</Link>
        </EmptyState>
      </div>
    );
  } else {
    body = <IpmaReady run={current} />;
  }

  return (
    <>
      <PageHeader
        title="IPMA"
        description="Importance-performance map analysis: how strongly each construct affects a target (total effect) against how well it performs on a 0–100 scale."
      />
      {body}
    </>
  );
}
