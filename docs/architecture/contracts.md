# Canonical contracts — design

This document specifies the shared data contracts. The executable definition is the Zod
source in `packages/contracts/src`; the JSON Schema in `packages/contracts/schema` is
generated from it. (A Pydantic mirror existed while the API service did; it was removed with the server in Phase 4.) If this
prose and the Zod source disagree, the Zod source wins and this file must be corrected.

All contracts carry `schemaVersion`. Current version: **1**.

## 1. Five things that are never mixed

| Contract | What it is | What it must never contain |
|---|---|---|
| `SemModel` | the scientific specification | coordinates, colours, results |
| `SemLayout` | where things are drawn | anything an estimator reads |
| `DatasetRef` / `DatasetSchema` | fingerprint + column schema | row-level values |
| `AnalysisConfiguration` | method, engine, estimator, options, seed | the model or the data |
| `NormalizedSemResult` | numbers produced by an engine, with provenance | presentation (decimals, captions, colours) |

`SemProject` bundles a model, a layout, an optional dataset reference and the current
analysis configuration. `AnalysisRun` is an immutable record binding
`modelHash` + `dataFingerprint` + configuration + engine versions to a result.

## 2. `SemModel`

```ts
type MeasurementKind = 'reflective' | 'composite-formative';

interface SemConstruct {
  id: string;                 // stable opaque id, never reused, never shown in syntax
  name: string;               // short code used in tables and generated syntax: "PU"
  label?: string;             // long name: "Perceived usefulness"
  measurement: MeasurementKind;
  indicatorIds: string[];     // ORDERED block membership; first reflective indicator is the CB marker
  plsWeightingMode?: 'mode-a' | 'mode-b';   // optional override; default derives from `measurement`
  higherOrder?: { approach: 'repeated-indicators' | 'two-stage'; childConstructIds: string[] }; // reserved, gated
}

interface SemIndicator {
  id: string;
  name: string;               // code: "PU1"
  label?: string;             // item wording
  column: string | null;      // bound dataset column; null = not yet mapped
  scale?: { min: number; max: number };     // ORIGINAL permissible endpoints (IPMA, reverse scoring)
  reverseScored?: boolean;
  level?: 'continuous' | 'ordinal' | 'binary';
}

type SemRelationship =
  | { id: string; kind: 'structural'; sourceId: string; targetId: string;      // construct → construct
      hypothesis?: string; parameterLabel?: string; fixedValue?: number }
  | { id: string; kind: 'covariance'; sourceId: string; targetId: string;      // construct↔construct or indicator↔indicator (residual)
      parameterLabel?: string; fixedValue?: number };

interface SemModel { constructs: SemConstruct[]; indicators: SemIndicator[]; relationships: SemRelationship[] }
```

### Deliberate deviation from the PLAN §3.3 sketch

The sketch lists both `construct.indicatorIds` and a `'measurement'` relationship kind,
which would store block membership twice. Two sources of truth for the measurement model
is exactly the kind of inconsistency that produces wrong estimator input, so membership
lives **only** in `construct.indicatorIds`. Measurement arrows in the diagram are
*derived*: one per (construct, indicator) pair, with the deterministic id
`meas:<constructId>:<indicatorId>`, drawn construct → indicator for `reflective` and
indicator → construct for `composite-formative`. Flipping a construct's measurement kind
flips all of its arrows, because in PLS the measurement mode is a property of the block,
not of a single arrow.

### Method semantics of a construct (the PLS/CB distinction, made explicit)

| `measurement` | `pls-sem` | `plsc` | `cb-sem` |
|---|---|---|---|
| `reflective` | composite, Mode A weights, **no** attenuation correction | common factor: Mode A weights + consistency correction | common factor (`=~`) |
| `composite-formative` | composite, Mode B weights | composite, Mode B weights, not corrected | **not supported** (validator error; no silent conversion) |

A reflective block estimated by `pls-sem` and by `cb-sem` targets different estimands.
Results from the two are never merged or labelled interchangeably.

### Invariants enforced by the schema or by `validateModelStructure` (pure TS, mirrored in Python)

- ids unique across constructs, indicators and relationships; names unique within their kind;
- every `indicatorIds` entry exists; relationship endpoints exist and have the right kind;
- no duplicate structural path, no self-loop, covariance endpoints of the same element type;
- construct and indicator `name` must be non-empty after trimming; they may contain any
  printable characters — code generators are responsible for quoting, not the model;
- `scale.min < scale.max` when present.

Semantic rules that depend on method/engine (cycles, identification, cross-loadings,
single-indicator handling) belong to the validator, not the schema.

## 3. `SemLayout`

```ts
interface SemLayout {
  nodes: Record<string, { x: number; y: number; pinned?: boolean }>;   // keyed by construct/indicator/annotation id
  edgeLabels?: Record<string, { dx: number; dy: number }>;            // manual label offsets, keyed by edge id
  annotations?: Array<{ id: string; text: string; x: number; y: number; width?: number }>;
  settings: {
    direction: 'LR' | 'RL' | 'TB' | 'BT';
    gridSize: number;            // 16
    snapToGrid: boolean;
    gridVisibility: 'dots' | 'faint' | 'hidden';
    constructShape: 'ellipse' | 'rounded';
    indicatorDensity: 'default' | 'dense';
    collapsedConstructIds: string[];
  };
}
```

## 4. Hashing

- `modelHash = sha256(canonicalJson(scientificProjection(model)))`.
- The projection keeps ids, names, measurement kinds, ordered `indicatorIds`, indicator
  `column`/`scale`/`reverseScored`/`level`, and relationships; it drops labels, item
  wording and hypothesis tags (documentation, not specification). Constructs,
  indicators and relationships are sorted by id; `indicatorIds` order is preserved.
- `canonicalJson`: UTF-8, object keys sorted, no insignificant whitespace, numbers in
  shortest round-trip form, `undefined` members omitted. Implemented identically in TS
  and Python and cross-tested with shared vectors in `packages/contracts/examples/hash/`.
- `layoutHash` is computed the same way over `SemLayout` and is independent.
- `dataFingerprint = sha256` over a canonical serialisation of the parsed table (column
  names + cell values), so the same data imported with a different delimiter has the
  same fingerprint.

## 5. `AnalysisConfiguration`

```ts
type SemMethod = 'pls-sem' | 'plsc' | 'cb-sem';
type EngineId = 'r-csem' | 'r-seminr' | 'r-lavaan' | 'py-semopy' | 'py-plspm';

interface AnalysisConfiguration {
  method: SemMethod;
  engine: EngineId;
  estimator: string;                       // validated against the capability registry for (method, engine)
  missingData: 'listwise' | 'fiml';
  seed?: number;                           // required when bootstrap.enabled
  bootstrap?: { enabled: boolean; repetitions: number; ci: 'percentile' | 'bca';
                confidenceLevel: number; sides: 'two-sided' | 'one-sided' };
  pls?: { innerWeighting: 'path' | 'centroid' | 'factorial'; maxIterations: number; tolerance: number };
  cb?:  { identification: 'marker' | 'std-lv'; meanStructure: boolean };
  ipma?: { targetConstructId: string };
}
```

Every option value is checked against the capability registry before a job is accepted.
An option the chosen engine does not implement is a validation error, never a silent
fallback to a default.

## 6. `NormalizedSemResult`

Results are *typed data*, not display tables. Display tables (columns, captions, notes,
decimals) are built in the web app by pure functions from this structure, so every
engine feeds the same tables and the Word export has a single definition.

```ts
type MissingReason = 'not-applicable' | 'not-requested' | 'not-estimated' | 'not-supported' | 'failed' | 'non-finite';
type Num = number | null;                          // null REQUIRES an entry in `missing`

interface ParameterEstimate {
  key: string;                                     // stable: "path:<srcId>-><tgtId>", "loading:<cId>:<iId>", ...
  kind: 'path' | 'loading' | 'weight' | 'total-effect' | 'indirect-effect' | 'specific-indirect'
      | 'covariance' | 'variance' | 'residual-variance' | 'intercept' | 'threshold' | 'defined';
  sourceId?: string; targetId?: string; viaIds?: string[]; relationshipId?: string;
  scale: 'standardized' | 'unstandardized';
  est: Num; se: Num; statistic: Num; statisticType?: 't' | 'z'; pValue: Num; ciLower: Num; ciUpper: Num;
  missing?: Partial<Record<'est' | 'se' | 'statistic' | 'pValue' | 'ciLower' | 'ciUpper', MissingReason>>;
  status: 'estimated' | 'fixed' | 'not-estimated' | 'failed';
  inference?: { method: 'bootstrap-percentile' | 'bootstrap-bca' | 'analytic' | 'robust-analytic';
                level: number; sides: 'two-sided' | 'one-sided'; nValid?: number };
  sourceMethod: string;                            // e.g. "cSEM::csem", "lavaan::sem"
  rawPath?: string;                                // where the number came from in the engine object
}

interface NormalizedSemResult {
  schemaVersion: 1;
  sample: { nRows: number; nUsed: number; nDropped: number; missingData: 'listwise' | 'fiml' };
  estimation: { converged: boolean; iterations: Num; admissible: boolean | null; messages: string[] };
  parameters: ParameterEstimate[];
  constructMetrics: Array<{ constructId: string; metric: string; value: Num; missing?: MissingReason; definition: string }>;
  matrices: Array<{ id: string; title: string; rowIds: string[]; colIds: string[]; values: Num[][];
                    symmetric: boolean; definition: string; missing?: MissingReason }>;
  fit: Array<{ name: string; value: Num; missing?: MissingReason; ciLower?: Num; ciUpper?: Num;
               variant?: 'standard' | 'scaled' | 'robust'; definition: string }>;
  bootstrap?: { requested: number; completed: number; failed: number; inadmissible: number; seed: number;
                ciMethod: 'percentile' | 'bca'; confidenceLevel: number; chunkSize: number;
                draws?: Record<string, number[]> };      // optional raw draws for selected parameters (histograms)
  ipma?: { targetConstructId: string;
           constructs: Array<{ constructId: string; importance: Num; performance: Num; predecessor: 'direct' | 'indirect' }>;
           indicators?: Array<{ indicatorId: string; constructId: string; importance: Num; performance: Num }>;
           convention: string };
  warnings: Array<{ code: string; severity: 'error' | 'warning' | 'recommendation' | 'info'; message: string; elementIds?: string[] }>;
  provenance: { engine: EngineId; packageVersions: Record<string, string>; rVersion?: string; pythonVersion?: string;
                call: string; startedAt: string; finishedAt: string };
}
```

Rules:

- No `NaN`, `Infinity` or `-Infinity` anywhere. A number an engine could not produce is
  `null` with a reason. `0` means an estimate of zero.
- A metric that does not apply (AVE of a formative block, HTMT involving a
  single-indicator construct) is `null` with `not-applicable` — it is never omitted in a
  way that could render as a passing blank, and never filled with a placeholder.
- All element references are model **ids**, never names, so renaming a construct does
  not orphan a stored result.

### Serialisation quirks shared by Zod and Pydantic (documented, tested)

- An integral float such as `5.0` is accepted where an integer is required (JSON has one
  number type; Python serialises integral floats with `.0`).
- An `optional` field must be **absent**, not `null`; `null` is only valid where the schema
  says `nullable` (result numbers). Producers omit absent optional fields.

## 7. Capability registry (`packages/method-registry/registry.json`)

```jsonc
{
  "schemaVersion": 1,
  "engines": [{ "id": "r-csem", "language": "R", "package": "cSEM", "version": "x.y.z", "license": "GPL-3" }],
  "capabilities": [{
    "id": "pls.inner-weighting.centroid",
    "family": "pls-sem",                  // pls-sem | cb-sem | resampling | assessment | prediction | ipma | export
    "title": "Centroid inner weighting scheme",
    "priority": "P1",
    "references": ["lohmoller1989"],      // keys into content/citations
    "engines": {
      "r-csem":   { "status": "beta", "verification": "engine-verified", "evidence": ["docs/validation/phase-0/evidence/r/..."], "notes": "" },
      "py-plspm": { "status": "planned", "verification": "engine-verified", "evidence": ["..."] },
      "r-lavaan": { "status": "unsupported", "verification": "none", "reason": "not a PLS engine" }
    }
  }]
}
```

- `status` ∈ `supported | beta | planned | unsupported` is what the **application**
  offers. `verification` ∈ `reference-tested | engine-verified | smoke-only | none` is the
  strength of the evidence.
- Enforced by test: `supported` requires `verification: "reference-tested"` and at least
  one evidence path that exists in the repository; every evidence path must exist;
  `unsupported` requires a `reason`.
- The UI, the API validator and the code exporter all read this one file. A control for
  a capability that is not `supported`/`beta` for the selected engine is disabled with
  the registry's explanation.
