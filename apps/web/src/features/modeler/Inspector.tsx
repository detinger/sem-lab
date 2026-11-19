import type {
  MeasurementKind,
  SemConstruct,
  SemIndicator,
  SemModel,
  SemRelationship,
} from '@sem-lab/contracts';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronsDownUp,
  ChevronsUpDown,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from 'lucide-react';
import { useId, useState } from 'react';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Select,
} from '@/components/ui';
import { constructRoles } from '@/domain/graph';
import * as ops from '@/domain/model-ops';
import { ResizeHandle } from './ResizeHandle';
import { useModeler } from './store';

const s = useModeler.getState;

/** Text input that commits on blur/Enter and shows the model's rejection inline. */
function CommitInput({
  label,
  value,
  onCommit,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => string | null;
  hint?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
    setError(null);
  }
  const commit = (): void => {
    if (draft === value) return;
    setError(onCommit(draft));
  };
  return (
    <Field label={label} hint={hint} error={error ?? undefined}>
      {(p) => (
        <Input
          {...p}
          size="small"
          value={draft}
          placeholder={placeholder}
          invalid={!!error}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(value);
          }}
        />
      )}
    </Field>
  );
}

function apply(fn: (m: SemModel) => SemModel): string | null {
  return s().edit(fn) ? null : s().lastError;
}

// ---------------------------------------------------------------- model tree (nothing selected)

function ModelTree({ model }: { model: SemModel }) {
  const roles = constructRoles(model);
  const orphans = model.indicators.filter((i) => ops.blocksOf(model, i.id).length === 0);
  if (model.constructs.length === 0) {
    return (
      <p className="inspector-hint">
        Add a construct with the toolbar, or start from a template. Select any element to edit it
        here.
      </p>
    );
  }
  return (
    <nav aria-label="Model elements" className="inspector-tree">
      <ul>
        {model.constructs.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="inspector-tree-item"
              onClick={() => s().select([c.id])}
            >
              <span className="inspector-tree-name">{c.name}</span>
              <span className="inspector-tree-meta">
                {c.measurement === 'reflective' ? 'Reflective' : 'Composite'} · {roles.get(c.id)} ·{' '}
                {c.indicatorIds.length} ind.
              </span>
            </button>
            {c.indicatorIds.length > 0 && (
              <ul>
                {c.indicatorIds.map((iid) => {
                  const i = ops.indicatorById(model, iid);
                  return i ? (
                    <li key={iid}>
                      <button
                        type="button"
                        className="inspector-tree-item inspector-tree-child"
                        onClick={() => s().select([iid])}
                      >
                        {i.name}
                        {i.column === null && <Badge variant="warning">unmapped</Badge>}
                      </button>
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {orphans.length > 0 && (
        <Callout variant="warning" title="Indicators without a construct">
          {orphans.map((o) => o.name).join(', ')} — connect each to a construct, or delete it.
        </Callout>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------- construct

function ConstructPanel({ model, c }: { model: SemModel; c: SemConstruct }) {
  const layout = useModeler((st) => st.layout);
  const pinned = !!layout.nodes[c.id]?.pinned;
  const collapsed = layout.settings.collapsedConstructIds.includes(c.id);
  const [newIndicator, setNewIndicator] = useState('');
  const incoming = model.relationships.filter(
    (r) => r.kind === 'structural' && r.targetId === c.id,
  );
  const outgoing = model.relationships.filter(
    (r) => r.kind === 'structural' && r.sourceId === c.id,
  );
  const nameOf = (id: string): string => ops.constructById(model, id)?.name ?? id;
  const kindId = useId();

  const addIndicator = (): void => {
    const name = newIndicator.trim() || `${c.name}${c.indicatorIds.length + 1}`;
    let ids: string[] = [];
    s().edit(
      (m) => {
        const r = ops.addIndicators(m, c.id, [{ name }]);
        ids = r.ids;
        return r.model;
      },
      (l, m) => {
        const base = l.nodes[c.id];
        if (!base) return l;
        const count = ops.constructById(m, c.id)?.indicatorIds.length ?? 1;
        return {
          ...l,
          nodes: { ...l.nodes, [ids[0]!]: { x: base.x - 140, y: base.y - 40 + (count - 1) * 48 } },
        };
      },
    );
    setNewIndicator('');
  };

  return (
    <div className="inspector-section">
      <CommitInput
        label="Name (short code used in tables and code)"
        value={c.name}
        onCommit={(v) => apply((m) => ops.updateConstruct(m, c.id, { name: v }))}
      />
      <CommitInput
        label="Label"
        value={c.label ?? ''}
        placeholder="e.g. Perceived usefulness"
        onCommit={(v) =>
          apply((m) => ops.updateConstruct(m, c.id, { label: v.trim() || undefined }))
        }
      />
      <div className="inspector-field">
        <span className="ui-field__label" id={kindId}>
          Measurement
        </span>
        <SegmentedControl<MeasurementKind>
          aria-label="Measurement type"
          size="small"
          value={c.measurement}
          onChange={(v) => apply((m) => ops.updateConstruct(m, c.id, { measurement: v }))}
          options={[
            { value: 'reflective', label: 'Reflective' },
            { value: 'composite-formative', label: 'Composite / formative' },
          ]}
        />
        <p className="inspector-hint">
          {c.measurement === 'reflective'
            ? 'Indicators reflect a common cause: arrows point from the construct to its indicators. Classic PLS estimates it as a Mode A composite; PLSc and CB-SEM treat it as a common factor.'
            : 'Indicators form the construct: arrows point into it. PLS estimates Mode B weights. Reliability measures such as α and AVE do not apply, and CB-SEM does not support this block.'}
        </p>
      </div>

      <h4 className="inspector-subheading">Indicators ({c.indicatorIds.length})</h4>
      {c.indicatorIds.length === 0 && (
        <p className="inspector-hint">
          No indicators yet. A construct needs at least one indicator to be estimated.
        </p>
      )}
      <ol className="inspector-list">
        {c.indicatorIds.map((iid, k) => {
          const i = ops.indicatorById(model, iid);
          return (
            <li key={iid} className="inspector-list-row">
              <button type="button" className="inspector-link" onClick={() => s().select([iid])}>
                {i?.name ?? iid}
              </button>
              {k === 0 && c.measurement === 'reflective' && <Badge>marker</Badge>}
              <span className="inspector-row-actions">
                <IconButton
                  size="small"
                  aria-label={`Move ${i?.name} up`}
                  disabled={k === 0}
                  onClick={() => apply((m) => ops.moveIndicatorInBlock(m, c.id, iid, k - 1))}
                >
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Move ${i?.name} down`}
                  disabled={k === c.indicatorIds.length - 1}
                  onClick={() => apply((m) => ops.moveIndicatorInBlock(m, c.id, iid, k + 1))}
                >
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton
                  size="small"
                  variant="danger"
                  aria-label={`Delete indicator ${i?.name}`}
                  onClick={() => apply((m) => ops.removeElements(m, [iid]))}
                >
                  <Trash2 size={14} />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="inspector-inline">
        <Input
          size="small"
          aria-label="New indicator name"
          placeholder={`${c.name}${c.indicatorIds.length + 1}`}
          value={newIndicator}
          onChange={(e) => setNewIndicator(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addIndicator()}
        />
        <Button size="small" icon={<Plus size={14} />} onClick={addIndicator}>
          Add indicator
        </Button>
      </div>
      {c.measurement === 'reflective' && c.indicatorIds.length > 0 && (
        <p className="inspector-hint">
          In CB-SEM with marker identification, the first indicator&apos;s loading is fixed to 1.
        </p>
      )}

      <h4 className="inspector-subheading">Paths</h4>
      {incoming.length + outgoing.length === 0 ? (
        <p className="inspector-hint">
          Not connected. Drag from a handle on this construct to another construct to add a
          structural path.
        </p>
      ) : (
        <ul className="inspector-list">
          {incoming.map((r) => (
            <li key={r.id} className="inspector-list-row">
              <button type="button" className="inspector-link" onClick={() => s().select([r.id])}>
                {nameOf(r.sourceId)} → {c.name}
              </button>
            </li>
          ))}
          {outgoing.map((r) => (
            <li key={r.id} className="inspector-list-row">
              <button type="button" className="inspector-link" onClick={() => s().select([r.id])}>
                {c.name} → {nameOf(r.targetId)}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="inspector-actions">
        <Button
          size="small"
          icon={pinned ? <PinOff size={14} /> : <Pin size={14} />}
          onClick={() => s().setPinned([c.id], !pinned)}
        >
          {pinned ? 'Unpin position' : 'Pin position'}
        </Button>
        <Button
          size="small"
          icon={collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          onClick={() =>
            s().setLayoutSettings({
              collapsedConstructIds: collapsed
                ? layout.settings.collapsedConstructIds.filter((x) => x !== c.id)
                : [...layout.settings.collapsedConstructIds, c.id],
            })
          }
        >
          {collapsed ? 'Show indicators' : 'Hide indicators'}
        </Button>
        <Button
          size="small"
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => apply((m) => ops.removeElements(m, [c.id]))}
        >
          Delete construct
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- indicator

function IndicatorPanel({ model, i }: { model: SemModel; i: SemIndicator }) {
  const blocks = ops.blocksOf(model, i.id);
  const [scaleError, setScaleError] = useState<string | null>(null);
  const setScale = (min: string, max: string): void => {
    if (min === '' && max === '') {
      setScaleError(apply((m) => ops.updateIndicator(m, i.id, { scale: undefined })));
      return;
    }
    const lo = Number(min);
    const hi = Number(max);
    if (min === '' || max === '' || !Number.isFinite(lo) || !Number.isFinite(hi)) {
      setScaleError('Enter both endpoints as numbers, or leave both empty.');
      return;
    }
    setScaleError(apply((m) => ops.updateIndicator(m, i.id, { scale: { min: lo, max: hi } })));
  };
  return (
    <div className="inspector-section">
      <CommitInput
        label="Name (code)"
        value={i.name}
        onCommit={(v) => apply((m) => ops.updateIndicator(m, i.id, { name: v }))}
      />
      <CommitInput
        label="Item wording"
        value={i.label ?? ''}
        placeholder="Optional questionnaire text"
        onCommit={(v) =>
          apply((m) => ops.updateIndicator(m, i.id, { label: v.trim() || undefined }))
        }
      />
      <CommitInput
        label="Data column"
        value={i.column ?? ''}
        hint="Name of the CSV column this indicator reads. Mapping against an imported dataset arrives with the Data Lab (Phase 2)."
        onCommit={(v) => apply((m) => ops.updateIndicator(m, i.id, { column: v.trim() || null }))}
      />
      <fieldset className="inspector-fieldset">
        <legend className="ui-field__label">Original scale endpoints</legend>
        <ScaleInputs scale={i.scale} onChange={setScale} />
        {scaleError ? (
          <p className="ui-field__error" role="alert">
            {scaleError}
          </p>
        ) : (
          <p className="inspector-hint">
            The permissible minimum and maximum of the instrument (e.g. 1 and 7), not the observed
            values. Required for IPMA and reverse scoring.
          </p>
        )}
      </fieldset>
      <Field label="Measurement level">
        {(p) => (
          <Select
            {...p}
            size="small"
            value={i.level ?? ''}
            onChange={(e) =>
              apply((m) =>
                ops.updateIndicator(m, i.id, {
                  level: (e.target.value || undefined) as SemIndicator['level'],
                }),
              )
            }
          >
            <option value="">Not specified</option>
            <option value="continuous">Continuous / interval</option>
            <option value="ordinal">Ordinal (e.g. Likert)</option>
            <option value="binary">Binary</option>
          </Select>
        )}
      </Field>
      <Checkbox
        label="Reverse-scored item"
        checked={!!i.reverseScored}
        onChange={(e) =>
          apply((m) =>
            ops.updateIndicator(m, i.id, { reverseScored: e.target.checked || undefined }),
          )
        }
      />
      <h4 className="inspector-subheading">Construct</h4>
      {blocks.length === 0 ? (
        <Callout variant="warning">
          This indicator measures no construct. Drag a connection between it and a construct.
        </Callout>
      ) : (
        blocks.map((b) => (
          <button
            key={b.id}
            type="button"
            className="inspector-link"
            onClick={() => s().select([b.id])}
          >
            {b.name} ({b.measurement === 'reflective' ? 'reflective' : 'composite'})
          </button>
        ))
      )}
      <div className="inspector-actions">
        <Button
          size="small"
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => apply((m) => ops.removeElements(m, [i.id]))}
        >
          Delete indicator
        </Button>
      </div>
    </div>
  );
}

function ScaleInputs({
  scale,
  onChange,
}: {
  scale?: { min: number; max: number };
  onChange: (min: string, max: string) => void;
}) {
  const [min, setMin] = useState(scale ? String(scale.min) : '');
  const [max, setMax] = useState(scale ? String(scale.max) : '');
  const commit = (): void => onChange(min.trim(), max.trim());
  return (
    <div className="inspector-inline">
      <Input
        size="small"
        inputMode="decimal"
        aria-label="Scale minimum"
        placeholder="min"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        onBlur={commit}
      />
      <span aria-hidden="true">–</span>
      <Input
        size="small"
        inputMode="decimal"
        aria-label="Scale maximum"
        placeholder="max"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

// ---------------------------------------------------------------- relationships

function RelationshipPanel({ model, r }: { model: SemModel; r: SemRelationship }) {
  const name = (id: string): string =>
    ops.constructById(model, id)?.name ?? ops.indicatorById(model, id)?.name ?? id;
  return (
    <div className="inspector-section">
      <p className="inspector-title">
        {r.kind === 'structural'
          ? `${name(r.sourceId)} → ${name(r.targetId)}`
          : `${name(r.sourceId)} ↔ ${name(r.targetId)}`}
      </p>
      <p className="inspector-hint">
        {r.kind === 'structural'
          ? 'A directed structural path: the source construct is modeled as predicting the target.'
          : 'A covariance (double-headed). Between constructs it frees their correlation; between indicators it is a correlated residual. Only CB-SEM estimates covariances; PLS-SEM ignores them.'}
      </p>
      {r.kind === 'structural' && (
        <CommitInput
          label="Hypothesis label"
          value={r.hypothesis ?? ''}
          placeholder="e.g. H1"
          onCommit={(v) =>
            apply((m) => ({
              ...m,
              relationships: m.relationships.map((x) =>
                x.id === r.id && x.kind === 'structural'
                  ? { ...x, hypothesis: v.trim() || undefined }
                  : x,
              ),
            }))
          }
        />
      )}
      <div className="inspector-actions">
        {r.kind === 'structural' && (
          <Button
            size="small"
            icon={<ArrowLeftRight size={14} />}
            onClick={() => apply((m) => ops.reverseStructuralPath(m, r.id))}
          >
            Reverse direction
          </Button>
        )}
        <Button
          size="small"
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => apply((m) => ops.removeElements(m, [r.id]))}
        >
          Delete {r.kind === 'structural' ? 'path' : 'covariance'}
        </Button>
      </div>
    </div>
  );
}

function MeasurementPanel({ model, id }: { model: SemModel; id: string }) {
  const [, cId, iId] = /^meas:(.+?):(.+)$/.exec(id) ?? [];
  const c = cId ? ops.constructById(model, cId) : undefined;
  const i = iId ? ops.indicatorById(model, iId) : undefined;
  if (!c || !i) return null;
  return (
    <div className="inspector-section">
      <p className="inspector-title">
        {c.measurement === 'reflective' ? `${c.name} → ${i.name}` : `${i.name} → ${c.name}`}
      </p>
      <p className="inspector-hint">
        Measurement arrows follow the construct&apos;s measurement type, so their direction is
        changed on the construct, not on a single arrow. Removing this arrow keeps the indicator but
        takes it out of {c.name}&apos;s block.
      </p>
      <div className="inspector-actions">
        <Button size="small" onClick={() => s().select([c.id])}>
          Edit {c.name}
        </Button>
        <Button
          size="small"
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => apply((m) => ops.removeElements(m, [id]))}
        >
          Remove from block
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- inspector

export interface InspectorProps {
  collapsed: boolean;
  onToggle: () => void;
  /** px the pane should grow (positive) or shrink (negative) as the divider is dragged */
  onResize: (deltaX: number) => void;
}

export function Inspector({ collapsed, onToggle, onResize }: InspectorProps) {
  const model = useModeler((st) => st.model);
  const selection = useModeler((st) => st.selection);
  const projectName = useModeler((st) => st.projectName);
  const lastError = useModeler((st) => st.lastError);

  if (collapsed) {
    return (
      <aside className="modeler-rail" data-side="right" aria-label="Inspector (collapsed)">
        <IconButton size="small" aria-label="Show inspector" onClick={onToggle}>
          <PanelRightOpen size={16} />
        </IconButton>
        <span className="modeler-rail__label">Inspector</span>
      </aside>
    );
  }

  let title = 'Model';
  let body;
  if (selection.length === 0) {
    body = (
      <>
        <CommitInput
          label="Project name"
          value={projectName}
          onCommit={(v) => (v.trim() ? (s().rename(v), null) : 'A project name cannot be empty.')}
        />
        <ModelTree model={model} />
      </>
    );
  } else if (selection.length > 1) {
    title = `${selection.length} elements selected`;
    body = (
      <div className="inspector-section">
        <p className="inspector-hint">
          Use Align and Distribute in the toolbar, drag to move them together, or press Delete to
          remove them.
        </p>
        <Button
          size="small"
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => apply((m) => ops.removeElements(m, selection))}
        >
          Delete selection
        </Button>
      </div>
    );
  } else {
    const id = selection[0]!;
    const c = ops.constructById(model, id);
    const i = ops.indicatorById(model, id);
    const r = model.relationships.find((x) => x.id === id);
    if (c) {
      title = `Construct · ${c.name}`;
      body = <ConstructPanel key={c.id} model={model} c={c} />;
    } else if (i) {
      title = `Indicator · ${i.name}`;
      body = <IndicatorPanel key={i.id} model={model} i={i} />;
    } else if (r) {
      title = r.kind === 'structural' ? 'Structural path' : 'Covariance';
      body = <RelationshipPanel key={r.id} model={model} r={r} />;
    } else if (id.startsWith('meas:')) {
      title = 'Measurement relation';
      body = <MeasurementPanel key={id} model={model} id={id} />;
    } else {
      body = <p className="inspector-hint">This element no longer exists.</p>;
    }
  }

  return (
    <aside className="modeler-inspector" aria-label="Inspector">
      <header className="modeler-inspector-header">
        <h2>{title}</h2>
        <IconButton size="small" aria-label="Hide inspector" onClick={onToggle}>
          <PanelRightClose size={16} />
        </IconButton>
      </header>
      <div className="modeler-inspector-body">
        {lastError && (
          <Callout variant="error" title="That change was not applied">
            {lastError}
          </Callout>
        )}
        {body}
      </div>
      <ResizeHandle side="left" ariaLabel="Resize inspector pane" onResize={onResize} />
    </aside>
  );
}
