import { Plus, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Button,
  Callout,
  Card,
  CardHeader,
  Field,
  IconButton,
  Input,
  Select,
} from '@/components/ui';
import type { Transformation } from '@/domain/dataset/types';
import { useModeler } from '@/features/modeler/store';
import { fmt, parseRowList, plural } from './format';
import { linkStateOf, useDataLab } from './store';

type Kind = 'reverse' | 'center' | 'standardize' | 'missing-code' | 'drop-column' | 'drop-rows';

const KIND_LABEL: Record<Kind, string> = {
  reverse: 'Reverse-score a column',
  center: 'Center a column',
  standardize: 'Standardize a column',
  'missing-code': 'Declare a missing-value code',
  'drop-column': 'Drop a column',
  'drop-rows': 'Drop rows',
};

export function describeTransformation(t: Transformation): string {
  switch (t.kind) {
    case 'reverse':
      return `Reverse-score ${t.column} (scale ${t.scale.min}–${t.scale.max}) into ${t.as}`;
    case 'center':
      return `Center ${t.column} into ${t.as}`;
    case 'standardize':
      return `Standardize ${t.column} (sample SD) into ${t.as}`;
    case 'missing-code':
      return `Treat ${t.code} as missing in ${t.column === '*' ? 'every numeric column' : t.column}`;
    case 'drop-column':
      return `Drop column ${t.column}`;
    case 'drop-rows':
      return `Drop ${plural(t.rows.length, 'row')} (original rows ${t.rows
        .slice(0, 6)
        .map((r) => r + 1)
        .join(', ')}${t.rows.length > 6 ? ', …' : ''})`;
  }
}

const SUFFIX: Partial<Record<Kind, string>> = { reverse: '_rev', center: '_c', standardize: '_z' };

export function TransformationsSection() {
  const dataset = useDataLab((s) => s.dataset);
  const setTransformations = useDataLab((s) => s.setTransformations);
  const ref = useModeler((s) => s.datasetRef);
  const model = useModeler((s) => s.model);
  const [kind, setKind] = useState<Kind>('reverse');
  const [column, setColumn] = useState('');
  const [name, setName] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [code, setCode] = useState('');
  const [rowsText, setRowsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numeric = useMemo(
    () => dataset?.columns.filter((c) => c.kind === 'numeric').map((c) => c.name) ?? [],
    [dataset],
  );
  if (!dataset) return null;
  const blocked = linkStateOf(ref, dataset) === 'mismatch';
  const names = new Set(dataset.columns.map((c) => c.name));
  const colList = kind === 'drop-column' ? dataset.columns.map((c) => c.name) : numeric;
  const mcColumns = kind === 'missing-code';
  const col =
    mcColumns && (column === '' || column === '*')
      ? '*'
      : colList.includes(column)
        ? column
        : (colList[0] ?? '');
  const needsName = kind === 'reverse' || kind === 'center' || kind === 'standardize';
  const asName = name !== '' ? name : `${col}${SUFFIX[kind] ?? ''}`;
  const origRows = dataset.original.rows.length;

  const boundScale = model.indicators.find((i) => i.column === col && i.scale)?.scale;
  const minText = min !== '' ? min : boundScale ? String(boundScale.min) : '';
  const maxText = max !== '' ? max : boundScale ? String(boundScale.max) : '';

  // Validation that the user can fix, reported next to the control.
  let nameError: string | undefined;
  let scaleError: string | undefined;
  let codeError: string | undefined;
  let rowsError: string | undefined;
  let built: Transformation | null = null;
  if (needsName && names.has(asName))
    nameError = `A column called ${asName} already exists. Choose another name.`;
  if (kind === 'reverse') {
    const lo = Number(minText);
    const hi = Number(maxText);
    if (
      minText === '' ||
      maxText === '' ||
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      !(lo < hi)
    ) {
      scaleError =
        'Reverse scoring needs the instrument’s permitted minimum and maximum (minimum below maximum).';
    } else if (col && !nameError) {
      built = { kind: 'reverse', column: col, scale: { min: lo, max: hi }, as: asName };
    }
  } else if (kind === 'center' || kind === 'standardize') {
    if (col && !nameError) built = { kind, column: col, as: asName };
  } else if (kind === 'missing-code') {
    const v = Number(code);
    if (code.trim() === '' || !Number.isFinite(v))
      codeError = 'Enter the numeric code, for example 99 or -99.';
    else built = { kind: 'missing-code', column: col === '' ? '*' : col, code: v };
  } else if (kind === 'drop-column') {
    if (col) built = { kind: 'drop-column', column: col };
  } else {
    const list = parseRowList(rowsText, origRows);
    if (!list) rowsError = `Enter row numbers between 1 and ${origRows}, such as 3, 7, 10-12.`;
    else built = { kind: 'drop-rows', rows: list, reason: 'Removed by the user' };
  }

  async function run(next: Transformation[]): Promise<boolean> {
    setBusy(true);
    const message = await setTransformations(next);
    setBusy(false);
    setError(message);
    return message === null;
  }

  const log = dataset.transformations;

  return (
    <Card className="dl-card" aria-labelledby="dl-trans-h">
      <CardHeader level={2} title={<span id="dl-trans-h">Transformations</span>} />
      <p className="dl-muted">
        The original file is never modified. Each step below is recorded in order and applied to a
        copy; remove a step to go back.
      </p>
      {blocked ? (
        <Callout variant="warning">
          These data differ from the data the project was built on. Link them to the project (see
          above) before transforming them.
        </Callout>
      ) : null}
      <div className="dl-trans-form">
        <Field label="Transformation">
          {(p) => (
            <Select
              {...p}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                setName('');
                setError(null);
              }}
            >
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {kind !== 'drop-rows' ? (
          <Field label="Column">
            {(p) => (
              <Select
                {...p}
                value={col}
                onChange={(e) => {
                  setColumn(e.target.value);
                  setName('');
                }}
              >
                {mcColumns ? <option value="*">Every numeric column</option> : null}
                {colList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {needsName ? (
          <Field label="New column name" error={nameError}>
            {(p) => <Input {...p} value={asName} onChange={(e) => setName(e.target.value)} />}
          </Field>
        ) : null}
        {kind === 'reverse' ? (
          <>
            <Field label="Scale minimum">
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={minText}
                  onChange={(e) => setMin(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Scale maximum"
              hint={boundScale ? 'Taken from the mapped indicator’s endpoints.' : undefined}
              error={scaleError}
            >
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={maxText}
                  onChange={(e) => setMax(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : null}
        {kind === 'missing-code' ? (
          <Field label="Code to treat as missing" error={code !== '' ? codeError : undefined}>
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {kind === 'drop-rows' ? (
          <Field
            label="Row numbers"
            hint="Row numbers of the original file (header excluded), for example 3, 7, 10-12."
            error={rowsText !== '' ? rowsError : undefined}
          >
            {(p) => <Input {...p} value={rowsText} onChange={(e) => setRowsText(e.target.value)} />}
          </Field>
        ) : null}
        <div className="dl-trans-form__go">
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            disabled={busy || blocked || built === null}
            onClick={() => {
              if (!built) return;
              void run([...log, built]).then((ok) => {
                if (ok) {
                  setName('');
                  setRowsText('');
                  setCode('');
                }
              });
            }}
          >
            Add transformation
          </Button>
        </div>
      </div>
      {error ? (
        <Callout variant="error" title="The transformation could not be applied">
          {error}
        </Callout>
      ) : null}

      <h3 className="dl-subhead">Transformation log</h3>
      {log.length === 0 ? (
        <p className="dl-muted">No transformations. The working table equals the original.</p>
      ) : (
        <>
          <ol className="dl-log" aria-label="Transformation log">
            {log.map((t, i) => (
              <li key={i}>
                <span className="dl-log__n">{i + 1}</span>
                <span className="dl-log__text">{describeTransformation(t)}</span>
                <IconButton
                  size="small"
                  aria-label={`Remove step ${i + 1}: ${describeTransformation(t)}`}
                  disabled={busy || blocked}
                  onClick={() => void run(log.filter((_, k) => k !== i))}
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ol>
          <Button
            size="small"
            icon={<Undo2 size={14} />}
            disabled={busy || blocked}
            onClick={() => void run(log.slice(0, -1))}
          >
            Undo last step
          </Button>
          <span className="dl-muted">
            {' '}
            {fmt(log.length)} {log.length === 1 ? 'step' : 'steps'} applied.
          </span>
        </>
      )}
    </Card>
  );
}
