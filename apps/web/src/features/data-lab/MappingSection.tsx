import { CircleAlert, Redo2, Undo2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  IconButton,
  Input,
  Select,
} from '@/components/ui';
import { analysisIndicators } from '@/domain/dataset/analysis-data';
import { applyMapping, suggestMapping } from '@/domain/dataset/mapping';
import type { ColumnProfile } from '@/domain/dataset/types';
import { updateIndicator } from '@/domain/model-ops';
import type { SemConstruct, SemIndicator, SemModel } from '@sem-studio/contracts';
import { useModeler } from '@/features/modeler/store';
import { fmt, plural } from './format';
import { editModel, useDataLab } from './store';

/**
 * Shown while endpoints are missing. The exact STYLE §11 sentence ("…to calculate performance")
 * belongs to the IPMA page; here, before any IPMA is requested, the callout names every use.
 */
export const IPMA_SCALE_TEXT =
  'Set the permitted minimum and maximum of the original response scale for each indicator (for example 1 and 7). IPMA performance and reverse scoring need them; they are never taken from the observed values.';

type Match = 'exact' | 'suggested' | 'manual' | 'missing' | 'pending' | 'nodata';

const withoutScale = (m: SemModel, id: string): SemModel => ({
  ...m,
  indicators: m.indicators.map((i) => {
    if (i.id !== id) return i;
    const { scale: _scale, ...rest } = i;
    return rest;
  }),
});

function parseEndpoint(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Two endpoint inputs; commits on blur or Enter so one edit = one undo step. */
function ScaleEditor({ indicator, profile }: { indicator: SemIndicator; profile?: ColumnProfile }) {
  const edit = editModel;
  const scale = indicator.scale;
  const [lo, setLo] = useState(scale ? String(scale.min) : '');
  const [hi, setHi] = useState(scale ? String(scale.max) : '');
  const [local, setLocal] = useState<string | null>(null);

  function commit(nextLo: string, nextHi: string): void {
    if (nextLo.trim() === '' && nextHi.trim() === '') {
      setLocal(null);
      if (scale) edit((m) => withoutScale(m, indicator.id));
      return;
    }
    const a = parseEndpoint(nextLo);
    const b = parseEndpoint(nextHi);
    if (a === null || b === null) {
      setLocal(
        nextLo.trim() === '' || nextHi.trim() === ''
          ? 'Enter both endpoints.'
          : 'Endpoints must be numbers.',
      );
      return;
    }
    if (!(a < b)) {
      setLocal('The minimum must be smaller than the maximum.');
      return;
    }
    setLocal(null);
    if (scale && scale.min === a && scale.max === b) return;
    edit((m) => updateIndicator(m, indicator.id, { scale: { min: a, max: b } }));
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commit(lo, hi);
  };
  const out =
    scale && profile?.kind === 'numeric' && profile.min !== null && profile.max !== null
      ? profile.min < scale.min || profile.max > scale.max
      : false;
  const id = `scale-${indicator.id}`;
  return (
    <div className="dl-scale">
      <div className="dl-scale__inputs">
        <Input
          size="small"
          inputMode="decimal"
          aria-label={`${indicator.name} scale minimum`}
          aria-describedby={`${id}-note`}
          placeholder="min"
          value={lo}
          invalid={out || local !== null}
          onChange={(e) => setLo(e.target.value)}
          onBlur={() => commit(lo, hi)}
          onKeyDown={onKey}
        />
        <span aria-hidden="true">–</span>
        <Input
          size="small"
          inputMode="decimal"
          aria-label={`${indicator.name} scale maximum`}
          aria-describedby={`${id}-note`}
          placeholder="max"
          value={hi}
          invalid={out || local !== null}
          onChange={(e) => setHi(e.target.value)}
          onBlur={() => commit(lo, hi)}
          onKeyDown={onKey}
        />
      </div>
      <p
        id={`${id}-note`}
        className="dl-scale__note"
        data-error={out || local !== null ? 'true' : 'false'}
      >
        {local ? (
          local
        ) : profile?.kind === 'numeric' && profile.min !== null ? (
          <>
            {out ? <CircleAlert size={12} aria-hidden="true" /> : null}
            observed {fmt(profile.min)}–{fmt(profile.max)}
            {out && scale ? `, outside ${scale.min}–${scale.max}` : ''}
          </>
        ) : (
          ' '
        )}
      </p>
    </div>
  );
}

function matchOf(
  ind: SemIndicator,
  hasData: boolean,
  names: ReadonlySet<string>,
  suggested: string | null,
): Match {
  if (ind.column !== null) {
    if (!hasData) return 'nodata';
    if (!names.has(ind.column)) return 'missing';
    if (ind.column === ind.name) return 'exact';
    if (suggested === ind.column) return 'suggested';
    return 'manual';
  }
  return suggested ? 'pending' : 'missing';
}

function MatchBadge({
  match,
  column,
  suggestion,
}: {
  match: Match;
  column: string | null;
  suggestion: string | null;
}) {
  switch (match) {
    case 'exact':
      return <Badge variant="success">exact</Badge>;
    case 'suggested':
      return <Badge variant="recommendation">suggested</Badge>;
    case 'manual':
      return <Badge>manual</Badge>;
    case 'pending':
      return <Badge variant="recommendation">suggestion: {suggestion}</Badge>;
    case 'nodata':
      return <Badge>no data loaded</Badge>;
    case 'missing':
      return column !== null ? (
        <Badge variant="error">missing: not in data</Badge>
      ) : (
        <Badge variant="warning">missing: not mapped</Badge>
      );
  }
}

function ConstructBlock({
  construct,
  indicators,
  columns,
  profiles,
  suggestions,
  selected,
  toggle,
}: {
  construct: SemConstruct;
  indicators: SemIndicator[];
  columns: string[];
  profiles: Map<string, ColumnProfile>;
  suggestions: Map<string, string | null>;
  selected: Set<string>;
  toggle: (id: string) => void;
}) {
  const edit = editModel;
  const [lo, setLo] = useState('1');
  const [hi, setHi] = useState('7');
  const a = parseEndpoint(lo);
  const b = parseEndpoint(hi);
  const valid = a !== null && b !== null && a < b;
  const names = useMemo(() => new Set(columns), [columns]);
  const hasData = columns.length > 0;
  return (
    <section className="dl-construct" aria-label={`Construct ${construct.name}`}>
      <div className="dl-construct__head">
        <h4 className="dl-construct__name">
          {construct.name}
          <span className="dl-muted"> · {construct.measurement}</span>
        </h4>
        <div className="dl-construct__bulk">
          <Input
            size="small"
            inputMode="decimal"
            aria-label={`${construct.name} scale minimum for all indicators`}
            value={lo}
            onChange={(e) => setLo(e.target.value)}
          />
          <span aria-hidden="true">–</span>
          <Input
            size="small"
            inputMode="decimal"
            aria-label={`${construct.name} scale maximum for all indicators`}
            value={hi}
            onChange={(e) => setHi(e.target.value)}
          />
          <Button
            size="small"
            disabled={!valid || indicators.length === 0}
            onClick={() =>
              valid &&
              edit((m) =>
                indicators.reduce(
                  (acc, i) => updateIndicator(acc, i.id, { scale: { min: a, max: b } }),
                  m,
                ),
              )
            }
          >
            Set {valid ? `${a}–${b}` : 'scale'} for all indicators of {construct.name}
          </Button>
        </div>
      </div>
      <ul className="dl-indicators">
        {indicators.map((ind) => {
          const suggestion = suggestions.get(ind.id) ?? null;
          const match = matchOf(ind, hasData, names, suggestion);
          const profile = ind.column !== null ? profiles.get(ind.column) : undefined;
          const colOptions =
            ind.column !== null && !names.has(ind.column) ? [ind.column, ...columns] : columns;
          return (
            <li key={ind.id} id={`map-ind-${ind.id}`} className="dl-indicator" data-match={match}>
              <div className="dl-indicator__who">
                <Checkbox
                  label={ind.name}
                  aria-label={`Select ${ind.name}`}
                  checked={selected.has(ind.id)}
                  onChange={() => toggle(ind.id)}
                />
              </div>
              <div className="dl-indicator__col">
                <Select
                  size="small"
                  aria-label={`Column for ${ind.name}`}
                  value={ind.column ?? ''}
                  invalid={match === 'missing' && ind.column !== null}
                  onChange={(e) =>
                    edit((m) =>
                      updateIndicator(m, ind.id, {
                        column: e.target.value === '' ? null : e.target.value,
                      }),
                    )
                  }
                >
                  <option value="">— not mapped —</option>
                  {colOptions.map((c) => (
                    <option key={c} value={c}>
                      {names.has(c) || !hasData ? c : `${c} (not in data)`}
                    </option>
                  ))}
                </Select>
                <MatchBadge match={match} column={ind.column} suggestion={suggestion} />
                {match === 'missing' && ind.column !== null ? (
                  <p className="dl-scale__note" data-error="true">
                    <CircleAlert size={12} aria-hidden="true" /> {ind.column} is not a column of the
                    data.
                  </p>
                ) : null}
                {profile && profile.kind !== 'numeric' ? (
                  <p className="dl-scale__note" data-error="true">
                    <CircleAlert size={12} aria-hidden="true" /> {ind.column} is {profile.kind}
                    {profile.nonNumericCount
                      ? ` (${plural(profile.nonNumericCount, 'non-numeric value')})`
                      : ''}
                    .
                  </p>
                ) : null}
              </div>
              <ScaleEditor
                key={`${ind.id}-${ind.scale?.min}-${ind.scale?.max}`}
                indicator={ind}
                {...(profile ? { profile } : {})}
              />
            </li>
          );
        })}
        {indicators.length === 0 ? (
          <li className="dl-muted">No indicators in this block yet.</li>
        ) : null}
      </ul>
    </section>
  );
}

export function MappingSection() {
  const model = useModeler((s) => s.model);
  const edit = editModel;
  const lastError = useModeler((s) => s.lastError);
  const canUndo = useModeler((s) => s.past.length > 0);
  const canRedo = useModeler((s) => s.future.length > 0);
  const dataset = useDataLab((s) => s.dataset);
  const profiles = useDataLab((s) => s.profiles);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLo, setBulkLo] = useState('1');
  const [bulkHi, setBulkHi] = useState('7');

  const columns = useMemo(() => dataset?.columns.map((c) => c.name) ?? [], [dataset]);
  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.name, p])), [profiles]);
  const suggestions = useMemo(
    () => (dataset ? suggestMapping(model, columns) : []),
    [dataset, model, columns],
  );
  const suggestedColumn = useMemo(
    () => new Map(suggestions.map((s) => [s.indicatorId, s.column])),
    [suggestions],
  );
  const used = useMemo(() => analysisIndicators(model), [model]);
  const byId = useMemo(() => new Map(model.indicators.map((i) => [i.id, i])), [model]);

  // Suggestions only fill gaps: they never overwrite a binding to a column that exists.
  const applicable = useMemo(() => {
    const have = new Set(columns);
    const taken = new Set(
      model.indicators
        .filter((i) => i.column !== null && have.has(i.column))
        .map((i) => i.column as string),
    );
    return suggestions.filter((s) => {
      if (s.match === 'none' || s.column === null || taken.has(s.column)) return false;
      const ind = byId.get(s.indicatorId);
      return ind !== undefined && (ind.column === null || !have.has(ind.column));
    });
  }, [suggestions, model, columns, byId]);

  const boundTo = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of model.indicators)
      if (i.column !== null) m.set(i.column, [...(m.get(i.column) ?? []), i.name]);
    return m;
  }, [model]);

  const noScale = used.filter((i) => !i.scale);
  // Data-first workflow: indicators dragged from the Modeler palette arrive already mapped, so the
  // common case is "all mapped" and the only remaining job is setting response scales.
  const colSet = useMemo(() => new Set(columns), [columns]);
  const unmapped = used.filter((i) => i.column === null || !colSet.has(i.column));
  const allMapped = dataset !== null && used.length > 0 && unmapped.length === 0;
  const bulkA = parseEndpoint(bulkLo);
  const bulkB = parseEndpoint(bulkHi);
  const bulkValid = bulkA !== null && bulkB !== null && bulkA < bulkB;
  const selectedIds = model.indicators.filter((i) => selected.has(i.id)).map((i) => i.id);
  const applyScale = (ids: string[]): void => {
    if (bulkValid)
      edit((m) =>
        ids.reduce((acc, id) => updateIndicator(acc, id, { scale: { min: bulkA, max: bulkB } }), m),
      );
  };
  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const empty = model.constructs.length === 0 && model.indicators.length === 0;
  const visibleColumns = columns.filter((c) =>
    c.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Card className="dl-card" aria-labelledby="dl-map-h" id="dl-mapping">
      <CardHeader
        level={2}
        title={<span id="dl-map-h">Column mapping &amp; response scales</span>}
        action={
          <span className="dl-badges">
            <IconButton
              size="small"
              aria-label="Undo (mapping and scale edits)"
              disabled={!canUndo}
              onClick={() => useModeler.getState().undo()}
            >
              <Undo2 size={16} />
            </IconButton>
            <IconButton
              size="small"
              aria-label="Redo"
              disabled={!canRedo}
              onClick={() => useModeler.getState().redo()}
            >
              <Redo2 size={16} />
            </IconButton>
          </span>
        }
      />
      {empty ? (
        <p className="dl-muted">
          The open project has no model yet. Build or open a model in the Modeler, then come back to
          bind its indicators to the columns of your data.
        </p>
      ) : (
        <>
          <p className="dl-muted">
            Indicators dragged onto constructs in the Modeler arrive already mapped to their column;
            map any remaining ones here. The main job on this page is setting each indicator&apos;s
            response scale. Edits change the project (not the data) and can be undone.
          </p>
          {allMapped ? (
            <Callout variant="success" title={`All ${used.length} indicators are mapped to columns`}>
              Nothing left to reconcile. Set their response scales below — IPMA and reverse scoring
              need the permitted minimum and maximum (e.g. 1 and 7).
            </Callout>
          ) : (
            <div className="dl-map-bar">
              <Button
                variant="primary"
                icon={<Wand2 size={14} />}
                disabled={applicable.length === 0}
                onClick={() => edit((m) => applyMapping(m, applicable))}
              >
                Apply suggestions{applicable.length > 0 ? ` (${applicable.length})` : ''}
              </Button>
              <span className="dl-muted">
                {dataset
                  ? applicable.length > 0
                    ? 'Binds unmapped indicators whose name matches a column unambiguously.'
                    : 'No unambiguous suggestions for unmapped indicators.'
                  : 'Import data to get suggestions.'}
              </span>
            </div>
          )}
          {noScale.length > 0 ? (
            <Callout variant="recommendation" title="Scale endpoints are missing">
              {IPMA_SCALE_TEXT}{' '}
              <a
                href={`#map-ind-${noScale[0]?.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const row = document.getElementById(`map-ind-${noScale[0]?.id}`);
                  row?.scrollIntoView({ block: 'center' });
                  row?.querySelector<HTMLElement>('input[inputmode]')?.focus();
                }}
              >
                Go to the first indicator without endpoints
              </a>{' '}
              ({noScale.length} of {used.length}).
            </Callout>
          ) : null}
          {lastError ? (
            <Callout variant="error" title="The edit was not applied">
              {lastError}
            </Callout>
          ) : null}
          <div className="dl-map-bulk" role="group" aria-label="Set response scale">
            <span className="dl-map-bulk__label">Response scale</span>
            <Input
              size="small"
              inputMode="decimal"
              aria-label="Scale minimum"
              value={bulkLo}
              onChange={(e) => setBulkLo(e.target.value)}
            />
            <span aria-hidden="true">–</span>
            <Input
              size="small"
              inputMode="decimal"
              aria-label="Scale maximum"
              value={bulkHi}
              onChange={(e) => setBulkHi(e.target.value)}
            />
            <Button
              size="small"
              variant="primary"
              disabled={!bulkValid || used.length === 0}
              onClick={() => applyScale(used.map((i) => i.id))}
            >
              Apply {bulkValid ? `${bulkA}–${bulkB}` : 'scale'} to all {used.length} indicators
            </Button>
            <Button
              size="small"
              disabled={!bulkValid || selectedIds.length === 0}
              onClick={() => applyScale(selectedIds)}
            >
              Apply to {selectedIds.length} selected
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => setSelected(new Set(model.indicators.map((i) => i.id)))}
            >
              Select all
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
          <div className="dl-map">
            <div className="dl-map__cols">
              <h3 className="dl-subhead">Columns in the data</h3>
              {dataset ? (
                <>
                  <Input
                    size="small"
                    type="search"
                    aria-label="Filter columns"
                    placeholder="Filter columns"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                  <ul className="dl-collist" aria-label="Columns in the data">
                    {visibleColumns.map((c) => {
                      const p = profileMap.get(c);
                      const to = boundTo.get(c);
                      return (
                        <li key={c}>
                          <span className="dl-collist__name">{c}</span>
                          {p && p.kind !== 'numeric' ? (
                            <Badge variant="warning">{p.kind}</Badge>
                          ) : null}
                          <span className="dl-collist__bound">
                            {to ? `→ ${to.join(', ')}` : 'unused'}
                          </span>
                        </li>
                      );
                    })}
                    {visibleColumns.length === 0 ? (
                      <li className="dl-muted">No column matches.</li>
                    ) : null}
                  </ul>
                </>
              ) : (
                <p className="dl-muted">Import data to list its columns here.</p>
              )}
            </div>
            <div className="dl-map__tree">
              <h3 className="dl-subhead">Constructs and indicators</h3>
              {model.constructs.map((c) => (
                <ConstructBlock
                  key={c.id}
                  construct={c}
                  indicators={c.indicatorIds
                    .map((id) => byId.get(id))
                    .filter((i): i is SemIndicator => i !== undefined)}
                  columns={columns}
                  profiles={profileMap}
                  suggestions={suggestedColumn}
                  selected={selected}
                  toggle={toggle}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
