/**
 * Phase 0 spike (c: remaining libraries): lucide-react, zod, papaparse, dexie, recharts.
 * Findings are summarised in docs/validation/phase-0/web-spike.md; measurements are written to
 * docs/validation/phase-0/evidence/web/*.json when SEM_WRITE_EVIDENCE=1.
 */
import 'fake-indexeddb/auto';

import { render } from '@testing-library/react';
import Dexie, { type EntityTable } from 'dexie';
import * as lucide from 'lucide-react';
import Papa from 'papaparse';
import { Scatter, ScatterChart, XAxis, YAxis } from 'recharts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { installMeasuringDom } from '../support/react-flow-dom';
import { writeEvidence } from './support/evidence';

const SIDEBAR_ICONS = [
  'layout-dashboard',
  'workflow',
  'table',
  'flask-conical',
  'chart-column-increasing',
  'scatter-chart',
  'chart-no-axes-combined',
  'git-compare-arrows',
  'notebook-tabs',
  'book-open',
  'target',
  'library',
  'settings',
];

const pascal = (kebab: string): string =>
  kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

describe('lucide-react', () => {
  it('exports every icon of the STYLE section 7 sidebar table', () => {
    const exports = lucide as unknown as Record<string, unknown>;
    const rows = SIDEBAR_ICONS.map((kebab) => {
      const name = pascal(kebab);
      const value = exports[name];
      return {
        icon: kebab,
        exportName: name,
        exists: value !== undefined,
        // components are plain functions or forwardRef objects; either way they are renderable
        kind: typeof value,
        inCanonicalIconMap: name in lucide.icons,
      };
    });
    const missing = rows.filter((row) => !row.exists).map((row) => row.icon);
    expect(missing).toEqual([]);

    // Alias note: ScatterChart is a deprecated alias of ChartScatter (same component).
    const scatterAlias = exports.ScatterChart === exports.ChartScatter;
    writeEvidence('lucide-icons.json', ['lucide-react'], {
      rows,
      missing,
      replacements: Object.fromEntries(missing.map((m) => [m, null])),
      scatterChartIsAliasOfChartScatter: scatterAlias,
      totalExports: Object.keys(lucide).length,
    });
  });

  it('renders an icon as an svg with size and strokeWidth props', () => {
    const { container } = render(<lucide.Workflow size={18} strokeWidth={2} aria-label="m" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('18');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
  });
});

describe('zod', () => {
  it('is major version 4 and emits JSON Schema natively with z.toJSONSchema', () => {
    const schema = z.object({
      kind: z.enum(['pls', 'cb']),
      label: z.string().optional(),
      items: z.array(z.object({ id: z.string(), weight: z.number() })),
    });
    const json = z.toJSONSchema(schema);
    expect(json).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['pls', 'cb'] },
        label: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, weight: { type: 'number' } },
            required: ['id', 'weight'],
            additionalProperties: false,
          },
        },
      },
      required: ['kind', 'items'],
      additionalProperties: false,
    });
    const draft7 = z.toJSONSchema(schema, { target: 'draft-7' });
    expect(draft7.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(typeof z.toJSONSchema).toBe('function');
    writeEvidence('zod-json-schema.json', ['zod'], {
      nativeToJSONSchema: true,
      draft2020: json,
      draft7Schema: draft7.$schema,
      notes: 'optional fields are omitted from required; objects get additionalProperties:false',
    });
  });
});

interface ParseRow {
  name: string;
  input: string;
  options: Record<string, unknown>;
  detectedDelimiter: string;
  fields: string[] | undefined;
  data: unknown[];
  errorCodes: string[];
}

function parse(name: string, input: string, options: Papa.ParseConfig = {}): ParseRow {
  const result = Papa.parse<Record<string, unknown>>(input, {
    header: true,
    skipEmptyLines: true,
    ...options,
  });
  return {
    name,
    input,
    options: { ...options },
    detectedDelimiter: result.meta.delimiter,
    fields: result.meta.fields,
    data: result.data,
    errorCodes: result.errors.map((e) => e.code),
  };
}

describe('papaparse', () => {
  const rows: ParseRow[] = [];

  it('1: semicolon input with 12-decimal numbers', () => {
    const text = 'a;b\n7.000000000000;1.250000000000\n';
    const raw = parse('semicolon-12-decimals-raw', text);
    const typed = parse('semicolon-12-decimals-dynamicTyping', text, { dynamicTyping: true });
    rows.push(raw, typed);
    expect(raw.detectedDelimiter).toBe(';');
    // Without dynamicTyping the exact text survives (preferred: the app types columns itself).
    expect(raw.data).toEqual([{ a: '7.000000000000', b: '1.250000000000' }]);
    // With dynamicTyping the numbers become JS numbers; trailing zeros (precision as typed) are lost.
    expect(typed.data).toEqual([{ a: 7, b: 1.25 }]);
  });

  it('2: BOM plus quoted fields containing the delimiter and a newline', () => {
    const text = '﻿"x;y";z\n"a;b\nc";1\n';
    const res = parse('bom-quoted', text);
    rows.push(res);
    expect(res.detectedDelimiter).toBe(';');
    expect(res.fields).toEqual(['x;y', 'z']); // BOM stripped from the first header
    expect(res.data).toEqual([{ 'x;y': 'a;b\nc', z: '1' }]);
    expect(res.errorCodes).toEqual([]);
  });

  it('3: decimal comma with semicolon delimiter is NOT converted by dynamicTyping', () => {
    const text = 'a;b\n7,25;1,5\n';
    const typed = parse('decimal-comma-dynamicTyping', text, { dynamicTyping: true });
    const forced = parse('decimal-comma-forced-delimiter', text, {
      dynamicTyping: true,
      delimiter: ';',
    });
    rows.push(typed, forced);
    expect(typed.detectedDelimiter).toBe(';');
    // The values stay strings: no silent mis-typing (not 7, not 725, not NaN).
    expect(typed.data).toEqual([{ a: '7,25', b: '1,5' }]);
    expect(forced.data).toEqual([{ a: '7,25', b: '1,5' }]);
    // So the app must detect this explicitly (string with /^-?\d+,\d+$/) and offer a decimal separator.
    // A comma-delimited file with decimal commas would be unparseable by design; check the mix-up:
    const comma = parse('decimal-comma-comma-delimited', 'a,b\n7,25,1\n', { dynamicTyping: true });
    rows.push(comma);
    expect(comma.errorCodes).toContain('TooManyFields');
  });

  it('4: tab-delimited input', () => {
    const res = parse('tab', 'a\tb\n1\t2\n', { dynamicTyping: true });
    rows.push(res);
    expect(res.detectedDelimiter).toBe('\t');
    expect(res.data).toEqual([{ a: 1, b: 2 }]);
  });

  it('records the observations', () => {
    expect(rows.length).toBeGreaterThanOrEqual(6);
    writeEvidence('papaparse.json', ['papaparse'], {
      rows,
      dynamicTypingTreatsDecimalCommaAsNumber: false,
    });
  });
});

describe('dexie with fake-indexeddb', () => {
  it('opens a database, puts and gets a record', async () => {
    interface ModelRow {
      id: string;
      title: string;
    }
    class TestDb extends Dexie {
      models!: EntityTable<ModelRow, 'id'>;
      constructor() {
        super('sem-studio-spike');
        this.version(1).stores({ models: 'id, title' });
      }
    }
    const db = new TestDb();
    await db.open();
    await db.models.put({ id: 'm1', title: 'TAM' });
    expect(await db.models.get('m1')).toEqual({ id: 'm1', title: 'TAM' });
    expect(await db.models.where('title').equals('TAM').count()).toBe(1);
    db.close();
    await Dexie.delete('sem-studio-spike');
    writeEvidence('dexie.json', ['dexie', 'fake-indexeddb'], {
      roundTrip: true,
      schema: "this.version(1).stores({ models: 'id, title' })",
    });
  });
});

describe('recharts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a ScatterChart under React 19 in jsdom without warnings', () => {
    installMeasuringDom({ width: 400, height: 300 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const data = [
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 5 },
    ];
    const { container } = render(
      <ScatterChart width={400} height={300}>
        <XAxis type="number" dataKey="x" />
        <YAxis type="number" dataKey="y" />
        <Scatter data={data} />
      </ScatterChart>,
    );
    expect(container.querySelector('.recharts-wrapper')).not.toBeNull();
    expect(container.querySelectorAll('.recharts-scatter-symbol').length).toBe(3);
    expect(errors.mock.calls).toEqual([]);
    expect(warns.mock.calls).toEqual([]);
    writeEvidence('recharts.json', ['recharts', 'react', 'react-dom'], {
      rendered: true,
      symbols: container.querySelectorAll('.recharts-scatter-symbol').length,
      consoleErrors: errors.mock.calls.length,
      consoleWarnings: warns.mock.calls.length,
      note: 'fixed width/height used; ResponsiveContainer needs ResizeObserver in jsdom',
    });
  });
});
