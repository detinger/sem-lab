import { FileUp, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Field,
  Input,
  Menu,
  Select,
  Spinner,
  ValidationRow,
} from '@/components/ui';
import { ACSI_ATTRIBUTION, BUNDLED_DATASETS, CC_BY_4_URL } from '@/domain/dataset/bundled';
import { DEFAULT_MAX_BYTES, delimiterName } from '@/domain/dataset/parse';
import { DEFAULT_MISSING_TOKENS, type Delimiter, type ParseIssue } from '@/domain/dataset/types';
import { plural } from './format';
import { useDataLab } from './store';

const ACCEPT = '.csv,.txt,.tsv,text/csv,text/tab-separated-values,text/plain';

function IssueList({ issues }: { issues: readonly ParseIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="dl-issues" aria-label="Import issues">
      {issues.map((issue, i) => (
        <li key={`${issue.code}-${i}`}>
          <ValidationRow
            severity={issue.severity}
            title={issue.message}
            defaultOpen={issue.severity === 'error'}
          >
            {issue.rows && issue.rows.length > 0 ? (
              <p className="dl-vrow-text">
                {plural(issue.rows.length, 'row')} affected: {issue.rows.join(', ')}
                {issue.rows.length >= 20 ? ' (first 20 shown)' : ''}.
              </p>
            ) : null}
            {issue.column ? <p className="dl-vrow-meta">Column: {issue.column}</p> : null}
            <p className="dl-vrow-meta">Code: {issue.code}</p>
          </ValidationRow>
        </li>
      ))}
    </ul>
  );
}

function ParseOptionsPanel() {
  const draft = useDataLab((s) => s.draft);
  const dataset = useDataLab((s) => s.dataset);
  const draftOptions = useDataLab((s) => s.draftOptions);
  const reparse = useDataLab((s) => s.reparse);
  const status = useDataLab((s) => s.status);
  const [delimiter, setDelimiter] = useState<string | null>(null);
  const [decimal, setDecimal] = useState<string | null>(null);
  const [tokens, setTokens] = useState<string | null>(null);
  if (!draft) return null;

  const report = dataset?.parse;
  const usedTokens = (
    dataset?.parseOptions.missingTokens ??
    draftOptions.missingTokens ??
    DEFAULT_MISSING_TOKENS
  )
    .filter((t) => t !== '')
    .join(', ');
  const delimiterValue = delimiter ?? draftOptions.delimiter ?? '';
  const decimalValue = decimal ?? draftOptions.decimal ?? '';
  const tokenText = tokens ?? usedTokens;

  const apply = (): void => {
    const missingTokens = [
      '',
      ...tokenText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ];
    void reparse({
      ...(delimiterValue ? { delimiter: delimiterValue as Delimiter } : {}),
      ...(decimalValue ? { decimal: decimalValue as '.' | ',' } : {}),
      missingTokens,
    });
  };

  return (
    <section className="dl-options" aria-label="Parse options">
      <h3 className="dl-subhead">Parse options</h3>
      <div className="dl-options__grid">
        <Field
          label="Delimiter"
          hint={
            report
              ? `Used: ${delimiterName(report.delimiter)}${report.delimiterDetected ? ' (detected)' : ''}`
              : undefined
          }
        >
          {(p) => (
            <Select {...p} value={delimiterValue} onChange={(e) => setDelimiter(e.target.value)}>
              <option value="">Detect automatically</option>
              <option value=",">Comma</option>
              <option value=";">Semicolon</option>
              <option value={'\t'}>Tab</option>
              <option value="|">Pipe</option>
            </Select>
          )}
        </Field>
        <Field
          label="Decimal mark"
          hint={
            report
              ? `Used: ${report.decimal === ',' ? 'comma' : 'point'}${report.decimalDetected ? ' (detected)' : ''}`
              : undefined
          }
        >
          {(p) => (
            <Select {...p} value={decimalValue} onChange={(e) => setDecimal(e.target.value)}>
              <option value="">Detect automatically</option>
              <option value=".">Point (1.5)</option>
              <option value=",">Comma (1,5)</option>
            </Select>
          )}
        </Field>
        <Field label="Missing-value tokens" hint="Comma-separated. Empty cells are always missing.">
          {(p) => <Input {...p} value={tokenText} onChange={(e) => setTokens(e.target.value)} />}
        </Field>
      </div>
      <div className="dl-options__actions">
        <Button icon={<RefreshCw size={14} />} onClick={apply} disabled={status === 'loading'}>
          Re-parse with these options
        </Button>
        <span className="dl-muted">
          Re-parsing starts again from the file as imported and clears the transformation log.
        </span>
      </div>
    </section>
  );
}

export function ImportSection() {
  const status = useDataLab((s) => s.status);
  const error = useDataLab((s) => s.error);
  const parseIssues = useDataLab((s) => s.parseIssues);
  const storageWarning = useDataLab((s) => s.storageWarning);
  const importFile = useDataLab((s) => s.importFile);
  const importBundled = useDataLab((s) => s.importBundled);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const loading = status === 'loading';

  const onFiles = (files: FileList | null): void => {
    const file = files?.[0];
    if (file) void importFile(file);
  };

  return (
    <Card className="dl-card" aria-labelledby="dl-import-h">
      <CardHeader
        level={2}
        icon={<FileUp size={18} />}
        title={<span id="dl-import-h">Import data</span>}
      />
      <div
        className="dl-drop"
        data-dragging={dragging ? 'true' : 'false'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
      >
        <Upload size={22} aria-hidden="true" className="dl-drop__icon" />
        <p className="dl-drop__title">Drop a CSV file here</p>
        <p className="dl-muted">
          .csv, .txt or .tsv, up to {DEFAULT_MAX_BYTES / 1048576} MB. The file is read in this
          browser and never uploaded.
        </p>
        <div className="dl-drop__actions">
          <Button
            variant="primary"
            icon={<FileUp size={16} />}
            onClick={() => input.current?.click()}
          >
            Import CSV
          </Button>
          <div className="dl-sample-menu">
            <Menu
              label="Use sample dataset"
              items={BUNDLED_DATASETS.map((d) => ({
                id: d.id,
                label: `${d.title}${d.synthetic ? '' : ' — CC BY 4.0'} · ${d.rows} × ${d.columns}`,
                onSelect: () => void importBundled(d.id),
              }))}
            />
          </div>
          {loading ? (
            <span className="dl-loading">
              <Spinner size={16} label="Reading data" /> Reading data…
            </span>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={ACCEPT}
          aria-label="Choose CSV file"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error ? (
        <Callout variant="error" title="The data could not be imported">
          {error}
        </Callout>
      ) : null}
      {storageWarning ? (
        <Callout variant="warning" title="Not stored in this browser">
          {storageWarning}
        </Callout>
      ) : null}
      <IssueList issues={parseIssues} />
      <ParseOptionsPanel />

      <div className="dl-provenance">
        <p>
          <Badge variant="accent">SYNTHETIC</Badge> Sample datasets labelled SYNTHETIC are generated
          by SEM Lab from a stated population model; they represent no real study.
        </p>
        <p className="dl-muted">
          <strong>ACSI 2015 sample data.</strong> {ACSI_ATTRIBUTION}{' '}
          <a href={CC_BY_4_URL} target="_blank" rel="noreferrer">
            CC BY 4.0 licence
          </a>
        </p>
      </div>
    </Card>
  );
}
