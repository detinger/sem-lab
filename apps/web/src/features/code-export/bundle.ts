/**
 * Export bundle (PLAN §2.9 "scripts + README / requirements manifest + reproducibility metadata +
 * warning list"): one ZIP with everything needed to rerun an analysis outside the app.
 *
 *   README.md             how to run it, what to expect, warnings, citations
 *   manifest.json         reproducibility manifest (hashes, versions, options, capabilities, files)
 *   model.json            the canonical model the run used
 *   analysis.json         the analysis options (engine "browser": the app's own definitions)
 *   analysis-data.csv     the exact matrix the app analysed (contains the user's data)
 *   browser-result.json   the result the app showed, for comparison
 *   R:      <project>-cSEM.R | <project>-lavaan.R
 *   Python: run_analysis.py, semlab_bundle.py, requirements.txt
 *
 * The manifest lists every other file with its SHA-256 so a reader can confirm nothing changed.
 */
import type { AnalysisConfiguration, NormalizedSemResult, SemModel } from '@sem-lab/contracts';
import { capability, registry, requiredCapabilities } from '@sem-lab/method-registry';
import type { AnalysisData, Transformation } from '@/domain/dataset/types';
import { analysisCsv } from './analysis-csv';
import { PYTHON_TESTED, exportPythonScript, pythonTolerance } from './python-script';
import { TESTED_VERSIONS, describeTransformation, exportCsemScript } from './r-csem';
import { LAVAAN_TESTED, exportLavaanScript } from './r-lavaan';
import { zip } from './zip';

export type ExportLanguage = 'r' | 'python';

export interface BundleInput {
  language: ExportLanguage;
  projectName: string;
  model: SemModel;
  analysis: AnalysisConfiguration;
  result: NormalizedSemResult;
  modelHash: string;
  dataFingerprint: string;
  runId: string;
  runCreatedAt: string;
  data: AnalysisData;
  transformations: Transformation[];
  generatedAt: string;
  appVersion: string;
  /** contents of packages/python-engine/dist/semlab_bundle.py (Python only) */
  pythonEngineSource?: string;
}

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ExportManifest {
  manifestVersion: 1;
  generator: { app: 'SEM Lab'; version: string };
  generatedAt: string;
  project: string;
  run: {
    id: string;
    createdAt: string;
    engine: string;
    packageVersions: Record<string, string>;
    call: string;
  };
  model: { hash: string; file: 'model.json'; constructs: number; indicators: number };
  data: {
    fingerprint: string;
    file: 'analysis-data.csv';
    rows: number;
    used: number;
    dropped: number;
    missingData: 'listwise' | 'fiml';
    reverseScoredColumns: string[];
    transformations: string[];
  };
  analysis: AnalysisConfiguration;
  capabilities: Array<{
    id: string;
    title: string;
    status: string;
    verification: string;
    evidence: string[];
  }>;
  script: {
    language: 'R' | 'Python';
    entryPoint: string;
    testedWith: Record<string, string>;
    expectedAgreement: string;
    verifiedBy: string;
  };
  warnings: Array<{ code: string; severity: string; message: string }>;
  citations: Array<{ key: string; text: string; doi?: string }>;
  files: ManifestFile[];
}

export interface ExportBundle {
  fileName: string;
  bytes: Uint8Array;
  manifest: ExportManifest;
  files: Array<{ path: string; content: string }>;
}

export const slug = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'sem-model';

async function sha256(text: string): Promise<{ bytes: number; sha256: string }> {
  const data = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return {
    bytes: data.length,
    sha256: [...digest].map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

const PACKAGE_CITATIONS: Record<string, { key: string; text: string; doi?: string }> = {
  cSEM: {
    key: 'rademaker2020',
    // as printed by citation("cSEM") for cSEM 0.7.1
    text: 'Rademaker, M. E., & Schuberth, F. (2020). cSEM: Composite-based structural equation modeling. R package version 0.7.1. https://floschuberth.github.io/cSEM/',
  },
};

/** Why this run cannot be exported in this language, or null. */
export function exportBlock(
  language: ExportLanguage,
  a: AnalysisConfiguration,
  model: SemModel,
): string | null {
  if (language === 'r' && a.method === 'cb-sem') {
    if (a.estimator !== 'ML' && a.estimator !== 'MLR')
      return `The lavaan export covers ML and MLR only; this run used ${a.estimator}.`;
    if (model.constructs.some((c) => c.measurement !== 'reflective'))
      return 'The lavaan export needs reflective constructs only; this model has composite constructs.';
  }
  return null;
}

export async function buildExportBundle(input: BundleInput): Promise<ExportBundle> {
  const { model, analysis: a, result, data, language } = input;
  const block = exportBlock(language, a, model);
  if (block) throw new Error(block);
  const isCb = a.method === 'cb-sem';
  const name = slug(input.projectName);
  const header = {
    model,
    analysis: a,
    projectName: input.projectName,
    modelHash: input.modelHash,
    dataFingerprint: input.dataFingerprint,
    nRows: data.nRows,
    nUsed: data.nUsed,
    transformations: input.transformations,
    generatedAt: input.generatedAt,
    appVersion: input.appVersion,
  };

  const files: Array<{ path: string; content: string }> = [];
  let script: ExportManifest['script'];
  if (language === 'r') {
    const entryPoint = `${name}-${isCb ? 'lavaan' : 'cSEM'}.R`;
    files.push({
      path: entryPoint,
      content: isCb
        ? exportLavaanScript(header)
        : exportCsemScript({ ...header, dataColumns: data.columns }),
    });
    script = isCb
      ? {
          language: 'R',
          entryPoint,
          testedWith: { R: LAVAAN_TESTED.R, lavaan: LAVAAN_TESTED.lavaan },
          expectedAgreement:
            'Estimates, standard errors and fit indices agree with the app to about 1e-6 (lavaan uses its own optimizer and convergence tolerance).',
          verifiedBy: 'apps/web/src/features/code-export/r-lavaan.test.ts',
        }
      : {
          language: 'R',
          entryPoint,
          testedWith: { R: TESTED_VERSIONS.R, cSEM: TESTED_VERSIONS.cSEM },
          expectedAgreement:
            'Estimates, bootstrap counts, percentile intervals and IPMA values agree with the app to 1e-12.',
          verifiedBy: 'apps/web/src/features/code-export/r-csem.test.ts',
        };
  } else {
    if (!input.pythonEngineSource) throw new Error('The Python engine source is missing.');
    files.push(
      { path: 'run_analysis.py', content: exportPythonScript(header) },
      { path: 'semlab_bundle.py', content: input.pythonEngineSource },
      {
        path: 'requirements.txt',
        content: `# Tested: Python ${PYTHON_TESTED.python}; supported numpy ${PYTHON_TESTED.numpy}, scipy ${PYTHON_TESTED.scipy}\nnumpy==${PYTHON_TESTED.pinned.numpy}\nscipy==${PYTHON_TESTED.pinned.scipy}\n# optional: pandas (DataFrames), matplotlib (IPMA plot)\n`,
      },
    );
    script = {
      language: 'Python',
      entryPoint: 'run_analysis.py',
      testedWith: {
        python: PYTHON_TESTED.python,
        numpy: PYTHON_TESTED.numpy,
        scipy: PYTHON_TESTED.scipy,
      },
      expectedAgreement: `The script checks every estimate, standard error, statistic, p value, interval, fit index and IPMA value against browser-result.json and stops if any differs by more than ${pythonTolerance(a)}.`,
      verifiedBy:
        'packages/python-engine/tests (TypeScript ↔ Python parity) and apps/web/src/features/code-export/bundle.test.ts',
    };
  }
  files.push(
    { path: 'model.json', content: `${JSON.stringify(model, null, 2)}\n` },
    { path: 'analysis.json', content: `${JSON.stringify({ ...a, engine: 'browser' }, null, 2)}\n` },
    { path: 'analysis-data.csv', content: analysisCsv(data) },
    { path: 'browser-result.json', content: `${JSON.stringify(result, null, 1)}\n` },
  );

  const caps = requiredCapabilities(model, a)
    .map((id) => ({ id, cap: capability(id) }))
    .filter((c): c is { id: string; cap: NonNullable<ReturnType<typeof capability>> } =>
      Boolean(c.cap),
    )
    .map(({ id, cap }) => {
      const e = cap.engines.browser;
      return {
        id,
        title: cap.title,
        status: e?.status ?? 'unsupported',
        verification: e?.verification ?? 'none',
        evidence: e?.evidence ?? [],
        references: cap.references,
      };
    });
  const citeKeys = [...new Set(caps.flatMap((c) => c.references))];
  const citations = [
    ...registry.citations
      .filter((c) => citeKeys.includes(c.key))
      .map((c) => ({ key: c.key, text: c.text, ...(c.doi ? { doi: c.doi } : {}) })),
    ...(language === 'r' && !isCb && PACKAGE_CITATIONS.cSEM ? [PACKAGE_CITATIONS.cSEM] : []),
  ];
  const reversed = model.indicators
    .filter(
      (i) =>
        i.reverseScored === true &&
        i.column !== null &&
        model.constructs.some((c) => c.indicatorIds.includes(i.id)),
    )
    .map((i) => i.column!);

  const manifest: ExportManifest = {
    manifestVersion: 1,
    generator: { app: 'SEM Lab', version: input.appVersion },
    generatedAt: input.generatedAt,
    project: input.projectName,
    run: {
      id: input.runId,
      createdAt: input.runCreatedAt,
      engine: result.provenance.engine,
      packageVersions: result.provenance.packageVersions,
      call: result.provenance.call,
    },
    model: {
      hash: input.modelHash,
      file: 'model.json',
      constructs: model.constructs.length,
      indicators: model.indicators.length,
    },
    data: {
      fingerprint: input.dataFingerprint,
      file: 'analysis-data.csv',
      rows: data.nRows,
      used: data.nUsed,
      dropped: data.nDropped,
      missingData: data.missingData,
      reverseScoredColumns: [...new Set(reversed)],
      transformations: input.transformations.map(describeTransformation),
    },
    analysis: a,
    capabilities: caps.map(({ references: _r, ...c }) => c),
    script,
    warnings: result.warnings.map(({ code, severity, message }) => ({ code, severity, message })),
    citations,
    files: [],
  };
  files.push({
    path: 'README.md',
    content: readme(manifest, input, [...files.map((f) => f.path), 'README.md']),
  });
  for (const f of files) manifest.files.push({ path: f.path, ...(await sha256(f.content)) });
  const all = [
    ...files,
    { path: 'manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
  ];
  return {
    fileName: `${name}-${language === 'r' ? 'R' : 'Python'}-export.zip`,
    bytes: zip(all.map((f) => ({ path: `${name}/${f.path}`, content: f.content }))),
    manifest,
    files: all,
  };
}

function methodLine(a: AnalysisConfiguration): string {
  if (a.method === 'cb-sem')
    return `CB-SEM, ${a.estimator}${a.missingData === 'fiml' ? ' with full-information ML for missing data' : ', listwise deletion'}, ${a.cb?.identification === 'std-lv' ? 'factor variances fixed to 1' : 'marker-variable identification'}`;
  const p = a.pls;
  const parts = [
    a.method === 'plsc' ? 'PLSc (consistent PLS)' : 'PLS-SEM (classic PLS path modeling)',
    p
      ? `${p.innerWeighting} inner weighting, at most ${p.maxIterations} iterations, tolerance ${p.tolerance}`
      : '',
  ];
  if (a.bootstrap?.enabled)
    parts.push(
      `${a.bootstrap.repetitions} bootstrap draws (seed ${a.seed ?? 0}), ${a.bootstrap.ci} ${Math.round(a.bootstrap.confidenceLevel * 100)}% ${a.bootstrap.sides} intervals`,
    );
  if (a.ipma) parts.push('IPMA');
  return parts.filter(Boolean).join('; ');
}

function readme(m: ExportManifest, input: BundleInput, filePaths: string[]): string {
  const r = m.script.language === 'R';
  const L: string[] = [];
  L.push(
    `# ${m.project.replace(/[\r\n]+/g, ' ')} — reproducible analysis`,
    '',
    `Exported by SEM Lab ${m.generator.version} on ${m.generatedAt}. Method: ${methodLine(m.analysis)}.`,
    '',
    '> **This folder contains your data** (`analysis-data.csv`). Share it only as your ethics approval and consent allow.',
    '',
    '## Files',
    '',
    '| File | What it is |',
    '|---|---|',
  );
  const what: Record<string, string> = {
    'run_analysis.py': 'Runs the analysis and checks the numbers against the app',
    'semlab_bundle.py':
      "SEM Lab's estimation engine for Python (the verified port of the app's engine)",
    'requirements.txt': 'Python packages',
    'model.json': 'The model (constructs, indicators, paths) as SEM Lab stores it',
    'analysis.json': 'The analysis settings',
    'analysis-data.csv': `The data the app analysed: ${m.data.used} of ${m.data.rows} rows${m.data.reverseScoredColumns.length ? '; reverse-scored columns already reversed' : ''}`,
    'browser-result.json': 'The result the app showed, for comparison',
    'README.md': 'This file',
  };
  what[m.script.entryPoint] ??= `The ${r ? 'R' : 'Python'} script`;
  for (const p of filePaths) L.push(`| \`${p}\` | ${what[p] ?? ''} |`);
  L.push(
    '| `manifest.json` | Reproducibility manifest: hashes, versions, settings, SHA-256 of every file |',
    '',
  );
  L.push('## How to run', '');
  if (r) {
    const pkg = m.analysis.method === 'cb-sem' ? 'lavaan' : 'cSEM';
    L.push(
      `1. Install R ${m.script.testedWith.R} (other versions usually work) and the package: \`install.packages("${pkg}")\`.`,
      `2. Open a terminal in this folder and run \`Rscript ${m.script.entryPoint}\` — or open the script in RStudio and set this folder as the working directory (Session → Set Working Directory → To Source File Location).`,
      '',
      `Tested with ${Object.entries(m.script.testedWith)
        .map(([k, v]) => `${k} ${v}`)
        .join(' and ')}. ${m.script.expectedAgreement}`,
    );
  } else {
    L.push(
      '1. Python 3.10 or newer. In this folder: `python -m pip install -r requirements.txt`.',
      '2. Run `python run_analysis.py`.',
      '',
      'Also works in Google Colab or Jupyter: upload the folder and run `!python run_analysis.py`, or `import semlab_bundle as semlab` in a notebook.',
      '',
      m.script.expectedAgreement,
    );
  }
  L.push('', '## What you should see', '');
  const lab = new Map<string, string>([
    ...input.model.constructs.map((c) => [c.id, c.name] as [string, string]),
    ...input.model.indicators.map((i) => [i.id, i.name] as [string, string]),
  ]);
  const paths = input.result.parameters.filter(
    (p) =>
      p.kind === 'path' &&
      p.scale === (m.analysis.method === 'cb-sem' ? 'unstandardized' : 'standardized'),
  );
  const f3 = (v: number | null): string => (v === null ? '—' : v.toFixed(3));
  if (paths.length) {
    L.push('| Path | Estimate | SE | p | CI |', '|---|---:|---:|---:|---|');
    for (const p of paths)
      L.push(
        `| ${lab.get(p.sourceId ?? '') ?? p.sourceId} → ${lab.get(p.targetId ?? '') ?? p.targetId} | ${f3(p.est)} | ${f3(p.se)} | ${f3(p.pValue)} | ${p.ciLower === null ? '—' : `[${f3(p.ciLower)}, ${f3(p.ciUpper)}]`} |`,
      );
    L.push('');
  }
  const fit = input.result.fit.filter(
    (f) =>
      ['chisq', 'df', 'cfi', 'tli', 'rmsea', 'srmr'].includes(f.name) &&
      (f.variant ?? 'standard') === 'standard',
  );
  if (m.analysis.method === 'cb-sem' && fit.length)
    L.push(
      `Fit: ${fit.map((f) => `${f.name} ${f.value === null ? '—' : f.name === 'df' ? f.value : f.value.toFixed(3)}`).join(', ')}.`,
      '',
    );
  if (input.result.ipma)
    L.push(
      `IPMA for ${lab.get(input.result.ipma.targetConstructId)}: ${input.result.ipma.constructs
        .map(
          (c) =>
            `${lab.get(c.constructId)} importance ${f3(c.importance)}, performance ${c.performance === null ? '—' : c.performance.toFixed(1)}`,
        )
        .join('; ')}.`,
      '',
    );
  if (m.warnings.length) {
    L.push('## Warnings from the analysis', '');
    for (const w of m.warnings)
      L.push(`- **${w.severity}** — ${w.message.replace(/[\r\n]+/g, ' ')}`);
    L.push('');
  }
  if (m.data.reverseScoredColumns.length || m.data.transformations.length) {
    L.push('## Data preparation', '');
    for (const c of m.data.reverseScoredColumns)
      L.push(`- \`${c}\` was reverse scored (min + max − x) before export.`);
    for (const t of m.data.transformations) L.push(`- ${t}`);
    L.push('');
  }
  L.push(
    '## Methods verified for this analysis',
    '',
    '| Capability | Status | Verification |',
    '|---|---|---|',
    ...m.capabilities.map((c) => `| ${c.title} | ${c.status} | ${c.verification} |`),
    '',
  );
  if (m.citations.length) {
    L.push('## References', '');
    for (const c of m.citations) L.push(`- ${c.text}${c.doi ? ` https://doi.org/${c.doi}` : ''}`);
    L.push('');
  }
  L.push(
    '## Checking the files',
    '',
    `Model hash \`${m.model.hash}\`; data fingerprint \`${m.data.fingerprint}\` (of the dataset as imported). \`manifest.json\` lists the SHA-256 of every file in this folder.`,
    '',
  );
  return L.join('\n');
}
