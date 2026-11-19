# Phase 1 — Design system, editor and persistence: evidence and exit review

Date: 2026-11-19. Runs in the browser only; no backend is needed or contacted.

## Exit criterion (PLAN §5)

> User can build a readable TAM diagram, auto arrange it, save/reopen and export it without an
> analysis backend.

**Met**, demonstrated by the Playwright suite `apps/web/e2e/modeler.spec.ts` (real Chrome):

| Step | Test |
|---|---|
| Build TAM from the template; 5 constructs and 22 indicators render; no console errors | `TAM template renders cleanly (light / dark)` |
| Draw a structural path with the mouse; a reciprocal path is refused | `a structural path can be drawn with the mouse…` |
| Auto arrange (direction change), undo, shortcuts dialog, SVG export download | `arrange, undo, shortcuts and SVG export…` |
| Autosave to IndexedDB and reopen after a page reload | `the project survives a reload` |
| Mobile width: inspector below the canvas, no horizontal overflow | `mobile layout stacks…` |

Screenshots reviewed by the architect: `apps/web/test-results/phase1-modeler/` (git-ignored;
regenerate with `npm run e2e --workspace @sem-studio/web`). The exported SVG of the TAM
template was rendered at 1:1 and inspected (classic TAM arrangement: PU stacked above PEOU,
then ATU → BI → USE; no path crosses a node; reflective arrows point to the indicators).

## Checklist

- [x] BPMN Studio design tokens and shell (`src/styles/tokens.css` is a verbatim copy of
      STYLE §16, guarded by a test); 232/64 px sidebar, 56 px header, light/dark/system theme.
- [x] React Flow construct and indicator nodes, one scene-driven edge type for structural,
      measurement and covariance relations, context-sensitive inspector with an accessible
      model tree.
- [x] Draw, select (click, Shift-lasso, Ctrl/Cmd-click), connect, delete, undo/redo (one step
      per drag), copy/cut/paste, project file import/export, autosave.
- [x] 16 px grid snapping, smart guides (take precedence over the grid), Alt bypass, Shift
      axis constraint, align ×6, distribute ×2, deterministic ELK auto layout in 4 directions,
      pinned positions, collapsible indicator blocks.
- [x] TAM template; SVG export and PNG export (2×, 3×) from the same scene as the canvas.
- [x] Light and dark designs, responsive layout (inspector 420 → 340 px → below the canvas),
      keyboard shortcuts (STYLE §9) with an in-app list.

## How correctness is guarded

| Property | Guard |
|---|---|
| Layout never changes the science | store test: arrange/align/distribute/pin/direction leave `modelHash` unchanged |
| Measurement membership has one source of truth | contracts: no `measurement` relationship kind; arrows derived from `indicatorIds` |
| Arrow direction encodes meaning | scene/SVG test: switching a block to composite flips every arrow of that block |
| Invalid connections impossible | model-ops tests: self-loop, duplicate, reciprocal, indicator↔indicator path, cross-loading rejected with a reason |
| Deterministic layout | 19 models × shuffled input order give identical coordinates |
| No overlaps, readable routing | 19 models: no node overlaps; every structural path clears every other construct (straight → gentle curve → S-curve → strong curve) |
| Export matches canvas | SVG node coordinates equal layout coordinates; one `buildScene()` feeds both |
| Hostile labels | SVG export escapes markup; test with `<script>` in a construct name |
| Saved projects are valid | IndexedDB store and file import validate against the Zod `SemProject` schema; readable errors for foreign/invalid/future-version files |

Test totals at the end of the phase: 301 web unit tests, 54 contract tests, 67 registry
tests, 6 browser tests. `npm run typecheck && npm run lint && npm run format:check && npm run
test && npm run build` all pass.

## Design decisions recorded

- **Triangle folding** (`foldPairs`): a source construct feeding a construct that only it
  feeds, with a shared successor, is drawn in one column (TAM: PU above PEOU). Removes a layer
  from chain-shaped models; never changes a relationship. Only sources are folded.
- **Indicator fans** wrap into rows of at most three above/below middle-layer constructs;
  rows are balanced (5 → 3 + 2) and centred.
- **Routing failures are not drawn dashed**, because STYLE §8 reserves dashed lines for
  unsupported relationships.
- **The "Data column" field** is a free-text binding until the Data Lab (Phase 2) maps
  columns against an imported dataset; scale endpoints are never inferred from data.
- **ELK runs on the main thread** (`elk.bundled.js`): ~70 ms for TAM. A worker is planned for
  models above ~100 nodes (Phase 8 performance item).

## Known limitations (carried forward)

- Fit-to-view of a large model at laptop width is an overview; labels become readable when
  zoomed. STYLE's 50+ construct target is a Phase 8 performance item.
- Edge labels cannot yet be dragged manually (contract field `edgeLabels` exists; UI pending).
- Annotations (contract field exists) have no UI yet.
- PNG export uses the browser's SVG rasteriser; fonts fall back to system fonts if Inter is
  not available to the image decoder.
- Visual regression is screenshot review, not pixel-diff assertion.
