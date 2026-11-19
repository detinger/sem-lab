# Phase 0 web spike: front-end library verification

Rule: a behaviour is "verified" only if a Vitest test in this repository asserts it and passes.
Tests live in `apps/web/src/tests/spike/` (`elk.spike.test.ts`, `reactflow.spike.test.tsx`,
`libs.spike.test.tsx`) and stay as regression tests. Measurements are written to
`docs/validation/phase-0/evidence/web/*.json` by `npm run spike:evidence -w @sem-lab/web`
(sets `SEM_WRITE_EVIDENCE=1`; ordinary test runs never write). Environment: macOS arm64, Node 26.13.1,
npm 11, jsdom 31, Vitest 5.1.0.

## 1. Pinned versions and licenses

Versions are exact in `apps/web/package.json`; licenses were read from each installed package's own
`package.json` (`apps/web/scripts/collect-licenses.mjs`, output `evidence/web/licenses.json`).

| Package | Version | License |
|---|---|---|
| react / react-dom / react-is | 19.3.1 | MIT |
| @xyflow/react | 12.12.1 (@xyflow/system 0.0.84) | MIT |
| elkjs | 0.12.1 | EPL-2.0 OR GPL-3.0-or-later |
| @dagrejs/dagre | 3.1.3 | MIT |
| zustand | 5.1.0 | MIT |
| @tanstack/react-query | 5.107.1 | MIT |
| zod | 4.6.7 | MIT |
| papaparse (+ @types 5.5.2) | 5.7.1 | MIT |
| dexie | 4.4.7 | Apache-2.0 |
| lucide-react | 1.72.0 | ISC |
| recharts | 3.10.1 | MIT |
| d3-scale / d3-array | 4.0.3 / 3.2.5 | ISC |
| react-router-dom | 7.18.5 | MIT |
| @fontsource-variable/inter, /jetbrains-mono | 5.3.0 | OFL-1.1 |
| dev: vite 8.3.8, vitest 5.1.0, jsdom 31.0.0, @testing-library/react 16.3.3, jest-dom 7.0.1, user-event 14.6.10, dom 10.4.2, @vitejs/plugin-react 6.3.0 | | MIT |
| dev: fake-indexeddb 6.2.8, @playwright/test 1.65.0 | | Apache-2.0 |

Playwright browsers were not downloaded. Root dev tooling: eslint 10.14.0, typescript 6.0.3, prettier 3.10.1.

**elkjs and EPL-2.0.** elkjs's package.json declares the dual license `EPL-2.0 OR GPL-3.0-or-later`; we
use it under EPL-2.0. EPL-2.0 is a file-level (weak) copyleft: modifications to EPL-licensed files must
be released under the EPL, but code that merely uses the library stays under its own license. For a
bundled SPA we ship the unmodified elkjs inside the JS bundle: we must keep its license notice and offer
the source of elkjs (public on npm/GitHub), and must not modify elkjs files without publishing those
modifications. Our own code is not infected. This is a notes-level reading, not legal advice; confirm
before distributing commercially. `react-is` was added as an explicit dependency because recharts
declares it as a peer dependency (see section 8).

## 2. ELK (`elkjs`) layout

Imports that work (all asserted): `import ELK from 'elkjs/lib/elk.bundled.js'` (engine inlined, runs on
the calling thread; used here), `import ElkMain from 'elkjs'`, and `elkjs/lib/elk-api.js` (needs a
worker; types from `elkjs/lib/elk-api`). Use `new ELK()`, `await elk.layout(graph, { layoutOptions })`,
`elk.knownLayoutOptions()`.

Options to use (all confirmed present among 243 known options, `elk-known-options.json`):
`elk.algorithm=layered`, `elk.direction=RIGHT`, `elk.edgeRouting` (ORTHOGONAL | POLYLINE | SPLINES),
`elk.randomSeed`, `elk.padding`, `elk.hierarchyHandling=INCLUDE_CHILDREN`, `elk.portConstraints`
(FIXED_SIDE / FIXED_ORDER / FIXED_POS), `elk.port.side`, `elk.port.index`, `elk.spacing.nodeNode`,
`elk.spacing.edgeNode`, `elk.spacing.edgeEdge`, `elk.spacing.edgeLabel`, `elk.spacing.componentComponent`,
`elk.layered.spacing.nodeNodeBetweenLayers`, `elk.layered.spacing.edgeNodeBetweenLayers`,
`elk.layered.spacing.edgeEdgeBetweenLayers`, `elk.layered.considerModelOrder.strategy`. An unknown
algorithm rejects with "Layout algorithm 'nope' not found". `knownLayoutOptions()` reports ids and value
types, not enum members.

**Determinism** (`elk-determinism.json`, TAM v1: 27 nodes, 28 edges, seed 1):
- Identical input, three runs: identical coordinates (max delta 0).
- Shuffling the order of `children` / `edges`: coordinates change (max delta 259 to 407 px, 17 to 27 of
  27 nodes moved, five shuffles).
- Therefore **ids must be sorted before layout**. Sorting children and edges by id after the shuffle
  restores identical output (delta 0 for every shuffle).
- `considerModelOrder.strategy` does NOT remove the order dependence; sort anyway.
- `elk.randomSeed=0` gave 6 distinct layouts in 6 runs (observation only): always pass a fixed seed.

**Timings** (`elk-timing.json`, bundled build, main thread, 7 runs, warm median):
TAM flat 27 nodes about 72 ms (min 12); 75 nodes about 215 ms; 350 nodes about 623 ms; constructs only:
15 constructs about 64 ms, 50 constructs about 190 ms. First run includes engine start-up (up to 611 ms
on the 350-node graph). Single-run timings are noisy; treat them as order of magnitude. Above roughly 100
nodes a worker (`elk-api` + `workerUrl`) is advisable.

**Edge sections and bend points: yes.** Every edge in a flat graph returns exactly one entry in
`edge.sections` with `startPoint`, `endPoint`, optional `bendPoints`, `incomingShape`, `outgoingShape`
(`elk-edge-routing.json`). ORTHOGONAL: 48 bend points over 28 edges, all 28 axis-aligned. POLYLINE: 3
bends. SPLINES: 71 control points; 28 of 28 readable as cubic Beziers. Edge ids in sections are
`<edgeId>_s0`.

Other verified facts: port sides default to WEST/EAST with FREE; `FIXED_SIDE` honours `elk.port.side`;
`FIXED_ORDER` + `elk.port.index` permutes port order (`elk-ports.json`). Gap between same-layer nodes
with an edge between them is `2 * elk.spacing.edgeNode + 1` (`elk-spacing.json`). Edge labels widen the
layout (934 to 1478 px) and are placed (`elk-edge-labels.json`). Compound nodes with
`INCLUDE_CHILDREN` give child coordinates relative to the group and cross-hierarchy edges are returned
at the root (`elk-compound.json`). Flat layout does not keep indicator order inside a block; either lay
out only the structural graph and place indicator fans ourselves, or use compound blocks
(`elk-flat-layout-shape.json`). Recommendation: layout the constructs-only graph with ELK, place
indicators deterministically.

## 3. React Flow (`@xyflow/react` 12.12.1)

Verified in `reactflow.spike.test.tsx` (`reactflow.json`): renders under React 19 and StrictMode; typed
`Node`/`Edge`/`NodeProps`/`EdgeProps`; `Handle`, `Position`, `BaseEdge`, `getStraightPath`, `Background`,
`BackgroundVariant` (`lines|dots|cross`), `Controls`, `MiniMap`, `ConnectionMode` (`strict|loose`),
`SelectionMode` (`partial|full`), `useNodesState`, `useEdgesState`, `addEdge`, `useReactFlow`,
`useNodesInitialized`, `getNodesBounds`, `getViewportForBounds`, `screenToFlowPosition`, `fitView`,
`snapToGrid` / `snapGrid`, `isValidConnection`, `onConnect`, `onNodeDragStop`, `onBeforeDelete`,
`onReconnect`, `nodeExtent`, `onlyRenderVisibleElements`, `colorMode`. Snap rule: final position is the
nearest grid point to (start position + pointer travel), so an off-grid start snaps on the first drag.
Connection by click: `connectOnClick` (default true), click source handle then target handle.

**jsdom polyfills.** jsdom 31 lacks `ResizeObserver`, `DOMMatrixReadOnly`, `IntersectionObserver`,
`Worker`; there is no layout (offsetWidth/Height are 0).
1. Render route (component tests): stub `ResizeObserver` (no-op) and give nodes explicit `width`,
   `height` and `handles`; edges render (`M 119,32.5L 208,32.5`), 0 console errors/warnings.
   `useNodesInitialized` stays false.
2. Measuring route (only for lifecycle tests): `ResizeObserver` that reports each element once,
   `DOMMatrixReadOnly` (only `m22` is read) and `HTMLElement.prototype.offsetWidth/offsetHeight`; then
   `node.measured` is filled and `useNodesInitialized` is true. Both live in
   `src/tests/support/react-flow-dom.ts`. `fitView()` promise does not settle in jsdom: assert viewport
   via `getViewportForBounds` instead. Drag simulation needs `eventView = globalThis.jsdom.window`,
   `autoPanOnNodeDrag=false`, one `act` per pointer event (first move only starts the drag).
   Connection tests need a `document.elementFromPoint` stub.
Typing note: `OnNodeDrag`'s event parameter is a pointer-event union, so only the node arguments are
type-pinned.

## 4. lucide-react 1.72.0

All 13 STYLE section 7 icons exist as exports; none missing, so no replacement is needed
(`lucide-icons.json`). Use PascalCase names: `LayoutDashboard`, `Workflow`, `Table`, `FlaskConical`,
`ChartColumnIncreasing`, `ChartScatter`, `ChartNoAxesCombined`, `GitCompareArrows`, `NotebookTabs`,
`BookOpen`, `Target`, `Library`, `Settings`. Caveat: `ScatterChart` (kebab `scatter-chart`) exists only
as a deprecated alias of `ChartScatter` and is absent from the canonical `icons` map; use
`ChartScatter`. Props `size` and `strokeWidth` render as svg attributes (asserted). Import named icons
only, to keep the bundle tree-shaken.

## 5. zod 4.6.7

Major version 4. Native JSON Schema emission exists: `z.toJSONSchema(schema, { target })` (default
draft 2020-12; `target: 'draft-7'` gives the draft-07 `$schema`). No companion library needed
(`zod-to-json-schema` is not required). Output for
`z.object({ kind: z.enum(['pls','cb']), label: z.string().optional(), items: z.array(z.object({ id: z.string(), weight: z.number() })) })`:
`$schema` 2020-12; `type: object`; `kind: { type: string, enum: [pls, cb] }`; `label: { type: string }`
and NOT in `required`; `items` an array of objects with their own `required` and
`additionalProperties: false`; root `required: [kind, items]`, `additionalProperties: false`. Full output
is asserted in the test and saved in `zod-json-schema.json`.

## 6. papaparse 5.7.1

All with `header: true, skipEmptyLines: true` (`papaparse.json`):
1. Semicolon, `7.000000000000;1.250000000000`: delimiter detected `;`. Without `dynamicTyping` the text
   is kept exactly (`'7.000000000000'`). With `dynamicTyping` values become numbers `7` and `1.25`:
   trailing zeros (the precision as typed) are lost. Prefer parsing as strings and typing columns in
   the app.
2. UTF-8 BOM + quoted fields containing `;` and a newline: BOM stripped (header `x;y` intact), delimiter
   `;`, cell `"a;b\nc"` preserved, no errors.
3. **Decimal comma, semicolon delimiter, `7,25;1,5`**: delimiter detected `;` (also when forced).
   `dynamicTyping` leaves the values as the strings `'7,25'` and `'1,5'`; it never converts them and
   does not mis-type them (not 7, not 725, not NaN). The app must therefore detect decimal-comma
   columns explicitly (string matching `^-?\d+,\d+$`) and ask or convert, never rely on `dynamicTyping`.
   A comma-delimited file with decimal commas yields `TooManyFields` errors.
4. Tab-delimited: delimiter detected `\t`; numbers typed with `dynamicTyping`.
Delimiter auto-detection returned the correct delimiter in all four cases.

## 7. dexie 4.4.7 + fake-indexeddb 6.2.8

`import 'fake-indexeddb/auto'` makes Dexie work in jsdom. Verified: subclass `Dexie`,
`this.version(1).stores({ models: 'id, title' })`, `await db.open()`, `put`, `get`, indexed
`where('title').equals(..).count()`, `Dexie.delete(name)`. Typed tables via `EntityTable<Row, 'id'>`.

## 8. recharts 3.10.1

A `ScatterChart` with `XAxis`/`YAxis`/`Scatter` renders under React 19.3.1 in jsdom: 3 symbols drawn,
0 `console.error`, 0 `console.warn`. React 19 caveats: recharts declares `react-is` as a peer
dependency, which npm installs but we pin explicitly (`react-is` 19.3.1, must match React's major); use
fixed `width`/`height` in tests because `ResponsiveContainer` needs `ResizeObserver` and real layout
(use the stub from section 3).

## 9. Theme tokens

`apps/web/src/styles/tokens.css` is a verbatim copy of STYLE section 16 (light and dark). The existing
`src/styles/tokens.test.ts` compares the file to the STYLE.md css block as exact text and checks the
declared custom properties in both themes; it passes. Note: running `prettier --write` on the file
rewrites the quotes and breaks the test, so the file is excluded in `.prettierignore` (and must be
passed `--ignore-path` when prettier is run by hand).

## 10. Clipboard: text/html and text/plain together (from lib.dom typings / MDN, no browser run)

```ts
const item = new ClipboardItem({
  'text/html': new Blob([html], { type: 'text/html' }),
  'text/plain': new Blob([plain], { type: 'text/plain' }),
});
await navigator.clipboard.write([item]);
```
`lib.dom.d.ts` types: `new ClipboardItem(items: Record<string, string | Blob | PromiseLike<string |
Blob>>, options?)`, `Clipboard.write(data: ClipboardItems): Promise<void>`. `ClipboardItem` and
`navigator.clipboard` are "available only in secure contexts" (HTTPS or localhost; check
`window.isSecureContext`). `write()` must be called from a user gesture and may reject with
`NotAllowedError`; Safari requires the values to be Blobs or promises created inside the handler. Provide
a fallback for `text/plain` only via `navigator.clipboard.writeText` or `document.execCommand('copy')`.
Receiving apps (Word, Excel, Docs) take `text/html` and fall back to `text/plain` (tab-separated for
tables). Not verified in a real browser; jsdom has no Clipboard API.

## 11. What did not work or needs care

- The earlier agent's `reactflow.spike.test.tsx` and `elk.spike.test.ts` failed `tsc`/eslint (an
  `OnNodeDrag` parameter assertion, `expect.any` typed `any`, a prop mutation flagged by
  `react-hooks/immutability`); fixed without changing what they assert.
- `fitView()` never settles in jsdom; ELK is order-dependent; dynamicTyping drops trailing zeros and does
  not handle decimal commas (sections 2, 3, 6).
- `apps/web/scripts/collect-licenses.mjs` was referenced by `spike:evidence` but missing; created.
- Root-level scripts also run every workspace; `packages/contracts` (owned by another step, in progress
  when this was written) was not in a green state, so green status is stated per `-w @sem-lab/web`.
- No `--force` or `--legacy-peer-deps` was used.
