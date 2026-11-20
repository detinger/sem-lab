# SEM Lab — STYLE.md

> **Visual specification for a new application.** This carries forward BPMN Studio's actual design tokens and component geometry; SEM-specific treatments below are **implementation targets**, not existing features. Pair with `PLAN.md`.


This guide applies BPMN Studio's visual design language to SEM Lab: a sophisticated visual modeling, quantitative research and learning workspace for PLS-SEM and CB-SEM. Preserve typography, color roles, density, surface hierarchy and interaction patterns while giving SEM diagrams, figures and analytical results their own coherent notation.

Core dimensions and colors below were extracted from BPMN Studio’s provided STYLE document. All SEM Lab features are proposed unless marked as inherited **design tokens**. Implement and test the design for its own interactive components; do not copy BPMN source selectors or dependencies.

## 1. Character and principles

The interface is a calm, compact workspace for learning and quantitative research. Cool gray backgrounds, bordered white or dark slate surfaces, blue actions, small outline icons, and restrained orange highlights give it its identity.

- **Keep the work prominent.** Models, datasets, explanations, tables and figures occupy most of the screen. Navigation and controls provide a quiet frame.
- **Use density with structure.** Compact controls sit in clearly grouped toolbars; larger gaps separate sections. Borders and spacing establish hierarchy before shadows do.
- **Give color a job.** Blue identifies actions and selection; orange highlights an active analysis, focal construct or milestone; semantic colors explain outcomes.
- **Explain alongside action.** Place hints, validation, empty states, and next steps near the relevant task.
- **Treat both themes as complete designs.** Surfaces, controls, charts, and embedded workspaces all change together.

To retain this character, avoid oversized marketing headings, decorative gradients, glass effects, heavy shadows on every surface, or pill-shaped primary controls. Pills belong to badges, filters, and step indicators.

## 2. Color tokens

Use semantic CSS variables throughout components. Keep palette values in a central theme layer. A token's role stays the same when its value changes between themes.

### Surfaces and text

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#f4f6f9` | `#0f141b` | Application background |
| `--bg-elevated` | `#ffffff` | `#171e27` | Navigation, cards, controls, dialogs |
| `--bg-subtle` | `#eef1f5` | `#1c2430` | Quiet grouping, table headers, neutral fills |
| `--bg-sunken` | `#e6eaf0` | `#121821` | Recessed tracks, such as progress bars |
| `--bg-hover` | `#e9eef5` | `#233042` | Hovered rows and controls |
| `--border` | `#d6dce5` | `#2b3645` | Default 1px dividers and outlines |
| `--border-strong` | `#b7c1cf` | `#3b4a5e` | Stronger outlines and hover borders |
| `--text` | `#17202c` | `#e6ebf1` | Main content and headings |
| `--text-muted` | `#4b5867` | `#b2bdcb` | Descriptions, labels, inactive navigation |
| `--text-subtle` | `#6b7787` | `#8a97a8` | Metadata, hints, secondary annotations |
| `--text-on-primary` | `#ffffff` | `#0b1520` | Text and icons on solid primary fills |

### Brand and interaction

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--primary` | `#1f5f8b` | `#5aa7d8` | Main actions, links, focus borders, selection |
| `--primary-hover` | `#184d72` | `#7ab9e3` | Solid primary button hover |
| `--primary-soft` | `#e3eef7` | `#16314a` | Selected navigation, controls, explanatory panels |
| `--primary-strong` | `#123b59` | `#a8d3ef` | Emphasized text within primary-tinted content |
| `--accent` | `#d9822b` | `#f0a457` | Special actions, active simulation, achievements |
| `--accent-soft` | `#fbeedd` | `#3a2a17` | Soft accent badges |

Solid accent buttons and analysis banners use dark text `#1d1205` in both themes. Do not assume every saturated background takes white text.

### Semantic feedback

| Role | Foreground light / dark | Soft background light / dark | Use |
| --- | --- | --- | --- |
| Error | `#c0392b` / `#f2776a` | `#fbe9e7` / `#3b1d1a` | Failure, invalid input, destructive action |
| Warning | `#b7791f` / `#e8b45a` | `#fdf3dc` / `#3a2d14` | Caution, incomplete state, potential problem |
| Recommendation | `#2b6cb0` / `#79b2ec` | `#e6f0fa` / `#172a40` | Advice, explanation, suggested improvement |
| Info | `#5a6779` / `#a3afbf` | `#eef1f5` / `#1f2833` | Neutral information and metadata |
| Success | `#2f855a` / `#6fcf97` | `#e3f4ea` / `#16301f` | Completion, correct answers, improved outcomes |

Tokens follow `--error` / `--error-soft`, `--warning` / `--warning-soft`, and the same pattern for the other roles. Informational **callouts** deliberately use the blue recommendation palette; neutral information **badges** use the gray info palette.

Pair semantic colors with readable labels or recognizable icons. Improvement and deterioration depend on the metric: a lower duration may be good, while a lower completion count may be bad.

## 3. Typography

```css
--font-sans: 'Inter', 'IBM Plex Sans', system-ui, -apple-system,
  'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace,
  SFMono-Regular, Menlo, monospace;
```

The BPMN Studio reference declares these stacks without bundling sans or monospace font files. For SEM Lab, either rely on the fallback stacks or legally self-host Inter and a monospace font if consistent typography across machines is important; include the weights used below.

| Element | Size | Weight | Other properties |
| --- | --- | --- | --- |
| Body | 14px | 400 | Line height 1.5 |
| Home hero heading | 32px | 650 | Tracking `-0.02em` |
| Page heading / h1 | 26px | 650 | Tracking `-0.01em` |
| Section heading / h2 | 20px | 650 | Tracking `-0.01em` |
| Card heading / h3 | 16px | 650 | Tracking `-0.01em` |
| Subheading / h4 | 14px | 650 | Tracking `-0.01em` |
| Dialog heading | 17px | 650 | No bottom margin |
| Hero description | 15px | 400 | Muted text |
| Compact content / table body | 13px | 400 | Also used in side panels |
| Field label / table heading | 12px | 600 | Muted text |
| Hint | 12px | 400 | Subtle text |
| Small metadata / badge | 11px | 400 / 650 | Keep secondary |
| KPI value | 22px | 700 | Tracking `-0.02em`, tabular numerals |
| Eyebrow | 12px | 600 | Uppercase, tracking `0.08em`, primary color |
| Navigation group label | 11px | 400 | Uppercase, tracking `0.06em` |

Headings use line height 1.25 and bottom margin `0.5em`. Paragraphs use bottom margin `0.75em`. Body text remains sentence case; uppercase is reserved for short group labels and eyebrows.

Use monospace for code, identifiers, traces, and keyboard shortcuts. Inline `code` and `kbd` are `0.92em`. Use `font-variant-numeric: tabular-nums` for metrics, numeric table columns, zoom values, and comparisons. Explanatory prose is limited to `76ch`; page-header descriptions to `72ch`.

## 4. Spacing, shape, and elevation

The BPMN Studio reference expressed most spacing as literal CSS values rather than a named token system. These recurring values form the practical scale to adopt for SEM Lab:

| Spacing | Typical use |
| --- | --- |
| 2–4px | Tight internal grouping, badge gaps, adjacent toolbar controls |
| 6px | Icon-to-label gaps, compact list gaps |
| 8px | Standard row gaps, small control padding |
| 10–12px | Form grids, compact surface padding, field separation |
| 14–16px | Panel padding, standard stacks and card-grid gaps |
| 18px | Default card and dialog-body padding |
| 20–24px | Page-header separation, larger layout gaps |
| 28–32px | Desktop page inset and hero spacing |
| 40–48px | Page bottom breathing room |

**Implementation recommendation:** expose these values as spacing tokens in SEM Lab while keeping the original proportions. Do not force every dimension onto a new scale if visual fidelity is the goal.

| Token / shape | Value | Use |
| --- | --- | --- |
| `--radius-sm` | 6px | Buttons, inputs, tabs' surrounding surfaces, callouts, menus |
| `--radius` | 10px | Cards, KPI tiles, grouped content |
| `--radius-lg` | 14px | Dialogs |
| Small local radius | 4px | Keyboard keys, focus outline shape, chart bar ends |
| Pill radius | 999px | Badges, chips, progress tracks, lesson steps |

| Token | Light | Dark |
| --- | --- | --- |
| `--shadow-sm` | `0 1px 2px rgba(16, 24, 40, 0.06)` | Same as light |
| `--shadow` | `0 2px 8px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.06)` | `0 2px 10px rgba(0, 0, 0, 0.45)` |
| `--shadow-lg` | `0 12px 32px rgba(16, 24, 40, 0.16)` | `0 16px 40px rgba(0, 0, 0, 0.6)` |
| `--focus-ring` | `0 0 0 3px rgba(31, 95, 139, 0.35)` | `0 0 0 3px rgba(90, 167, 216, 0.45)` |

Use a 1px border for most surface separation. Cards have the smallest shadow; hovered linked cards and toasts use the medium shadow; menus and dialogs use the large shadow.

## 5. Layout and responsive behavior

### Application shell

- Full-height shell with a left navigation column and a flexible main region.
- Expanded navigation is `232px`; collapsed navigation is `64px`.
- Brand row and workspace toolbar share a `56px` height token. The toolbar can grow when controls wrap.
- Navigation uses an elevated background and a right border. Group headings organize related tasks; utility actions sit at the bottom.
- Navigation links use `8px 10px` padding, a `10px` icon gap, and a `6px` radius. Selection uses primary text on a primary-soft background.
- Standard pages scroll inside the main region, with `28px 32px 48px` padding. Narrow pages are centered with a maximum width of `1080px`.
- Page headers place a title and description on the left and actions on the right, with wrapping and a `16px` gap.

### Page compositions

| Composition | Structure |
| --- | --- |
| Overview | Header → action or workflow cards → recent work / progress |
| Card collection | Auto-fill columns, minimum `260px`, `16px` gaps |
| SEM modeler | Toolbar → flexible React Flow canvas + `420px` inspector, collapsible data palette |
| Analysis configuration | `380px` configuration column + flexible results, `20px` gap |
| Reference content | `280px` sticky index + flexible article, `24px` gap |
| Results | Run provenance → summary cards → tabs → detailed tables/charts → interpretation |
| IPMA | Target selector → full-width importance-performance map → construct table/inspector |
| Data Lab | Upload/column mapping → preview and quality diagnostics → transformations |
| Colab examples | Model preview + learning objectives → notebook launch and dataset instructions |

Use `minmax(0, 1fr)`, `min-width: 0`, and `min-height: 0` in flexible workspaces so wide content and nested scrolling do not force the shell to expand.

### Inherited breakpoint targets

| Maximum viewport width | Adaptation |
| --- | --- |
| 1100px | Inspector narrows to `340px`; configuration/results layout becomes one column |
| 960px | Two-column home hero becomes one column |
| 900px | Two- and three-column utility grids become one column; reference index moves above content |
| 820px | Sidebar becomes a horizontal, scrollable navigation row; labels and group headings are hidden; page padding becomes `18px 16px 40px`; inspector moves below the canvas |

At the smallest modeler breakpoint, canvas and inspector rows should be defined as `minmax(320px, 1fr)` and `minmax(280px, 45vh)`. This is a dense research-workspace layout. **Transfer recommendation:** check SEM Lab's smallest supported screen and scrolling behavior instead of assuming these minimum heights fit every phone.

## 6. Component recipes

### Buttons and inputs

| Component | Geometry and treatment |
| --- | --- |
| Default button | `34px` high, `0 12px` padding, `6px` gap and radius, 1px border, elevated fill, weight 550 |
| Small button | `28px` high, `0 8px` padding, 13px text |
| Icon button | Square `34px`; small version `28px` |
| Primary button | Primary fill and border, text-on-primary foreground |
| Secondary button | Default bordered button; hover uses bg-hover and border-strong |
| Ghost button | Transparent fill and border; bg-hover on hover |
| Danger button | Error-colored text with the base button treatment |
| Selected button | Primary-soft fill, primary text and border |
| Input / select | `34px` high, `0 10px` padding, 6px radius, elevated fill, 1px border |
| Small input / select | `28px` high, `0 6px` padding, 13px text |
| Textarea | Auto height, `8px 10px` padding, vertical resize |

Disabled buttons use 50% opacity and a not-allowed cursor. Focused inputs use a primary border and the focus-ring shadow. Form fields stack label, control, and hint with a `4px` gap and `12px` separation between fields. Responsive field rows have `10px` gaps and minimum `120px` columns.

**Implementation recommendation:** give each task group one visually dominant action. Use labels with concrete verbs, such as “Run analysis,” “Import CSV,” or “Save changes.” Define explicit hover styles for accent and danger buttons instead of relying on base button hover behavior.

### Cards, lists, and selection

- Standard card: elevated background, 1px border, 10px radius, 18px padding, smallest shadow.
- Card title row: aligned title and utility action, 8px gap, 12px bottom spacing.
- Linked card hover: primary border and medium shadow. No actual translation or scaling is applied.
- Compact rows: small outline icon, label, optional metadata or trailing action; bg-hover signals interaction.
- Selected rows and options: primary-soft background with a primary outline where appropriate.
- Collection preview cards: `140px` preview region separated by a bottom border, followed by `12px 14px` body padding.

### Tabs, chips, and badges

- Tabs sit above a 1px bottom divider. Each tab has `9px 12px` padding, a `6px` icon gap, and weight 550. Selection uses primary text and a 2px bottom border.
- Tab strips scroll horizontally when needed. Inspector tabs are denser: 13px text and `10px 8px` padding.
- Filter chips use `3px 9px` padding, 12px text, a pill radius, and a 1px border. Selection adds primary-soft fill, primary border, and primary text.
- Status badges are `20px` high with `0 7px` padding, 11px text, weight 650, and a pill radius. Semantic variants use matching foreground/soft pairs and transparent borders.

### Feedback and progress

- Callouts use `10px 12px` padding, a 6px radius, an 18px leading icon, and a `10px` content gap. Semantic borders mix the role color with transparency: 30% for informational callouts and 35% for warning, error, and success.
- Validation rows use a 3px inset severity stripe, a severity icon, a short title, and expandable explanatory content. Explanations connect the problem to its consequence and a possible fix.
- Empty states are centered with `36px 16px` padding, a muted icon, a short heading, and helpful next-step content.
- Progress tracks are `8px` high, pill-shaped, and sunken; fills use primary color.
- Toasts stack at the bottom right, `16px` from the edges, with an `8px` gap. Each has `10px 14px` padding, 6px radius, medium shadow, and a 4px primary or semantic left border. Current widths are `260–420px`.

### Tables and metrics

- Wrap tables in a horizontally scrollable container with a 1px border and 6px radius.
- Body text is 13px; sticky header text is 12px, weight 600, muted, on bg-subtle.
- Cells use `7px 10px` padding and horizontal separators. Hover highlights the entire row.
- Right-align numeric columns and use tabular numerals. Keep units visible and number formatting consistent.
- KPI grids use minimum `170px` columns and `12px` gaps. Tiles use `12px 14px` padding, 10px radius, and a 1px border.
- KPI hierarchy: 12px muted label → 22px bold value → 11px subtle supporting detail. Outcome deltas use semantic colors and weight 650.

### Dialogs and menus

- Dialog backdrop: `rgba(10, 16, 24, 0.5)`, centered layout, `24px` viewport padding.
- Dialog: elevated fill, 1px border, 14px radius, large shadow, width `min(960px, 100%)`, maximum height `calc(100vh - 48px)`.
- Header: `14px 18px` padding and bottom divider. Body: 18px padding and vertical scrolling. Footer: `12px 18px` padding, top divider, actions aligned right with an 8px gap.
- Menus: minimum `230px` width, 6px radius, large shadow, 4px outer padding, 4px below their trigger. Items use `7px 10px` padding.
- Recommended layer order: watermark 10, canvas controls 15, canvas overlay 20, menus 30, dialogs 50, toasts 60, skip link 100.


## 7. Identity, iconography and navigation

### Product mark

Use the BPMN Studio brand's proportions: **30px primary square**, **8px radius**, **20px white/contrast mark**, 15px wordmark and 11px subtitle. For SEM Lab, design a simple **latent circle connected to three indicator rectangles** with clean 2px strokes (independent artwork; do not reuse SmartPLS assets). The brand may include the line "Structural Equation Modeling" in subtle text.

Use Lucide outline icons, generally `18px` navigation, `16px` buttons and `13–14px` compact row actions. Domain symbols (factor ellipse, indicator rectangle, covariance arrow) are **scientific notation**, not random icon replacements.

### Recommended sidebar

| Group | Item | Suggested icon | Notes |
|---|---|---|---|
| _(standalone)_ | Overview | `layout-dashboard` | Recent models and quick start; sits above the labelled groups |
| Workspace | Data | `table` | CSV import and mapping |
| Workspace | Modeler | `workflow` | Visual diagram editor |
| Workspace | Analysis | `flask-conical` | Algorithm settings and bootstrap |
| Workspace | Results | `chart-column-increasing` | Reliability, paths, fit, prediction |
| Workspace | IPMA | `scatter-chart` or `chart-no-axes-combined` | Distinctive importance-performance view |
| Workspace | Comparison | `git-compare-arrows` | Method/model comparison |
| Learn | Lessons | `book-open` | Progressive theory |
| Learn | Examples | `notebook-tabs` | Five Python notebooks |
| Learn | Challenges | `target` | Interactive assessment |
| Learn | Reference | `library` | Statistical glossary |

If an icon is missing in the chosen Lucide build, replace it with an actual available icon of comparable meaning. The overall shell keeps BPMN Studio's 232px/64px sidebar widths and 56px workspace header.

### Product vocabulary

- Prefer **Modeler**, **Run analysis**, **Bootstrap**, **Import CSV**, **Map indicators**, **Copy table**, **Export code**, **Arrange model**.
- Preserve method names **PLS-SEM**, **PLSc**, **CB-SEM**, **CFA**, **IPMA** without ornamental synonyms.
- Refer to constructs, observed indicators, paths, loadings, weights, residuals, and fit *precisely*.
- Status uses **Ready / Running / Completed / Failed / Unsupported** rather than vague "AI ready" labels.

---

## 8. SEM diagram system: signature canvas design

### Design objective

The model should feel **publication-grade while remaining easy to manipulate**. Large clean construct symbols, precisely positioned indicator labels, consistent connectors and generous white space must make complicated research models readable. The user should be able to generate polished TAM, ACSI-inspired and DeLone & McLean diagrams without manual pixel-by-pixel positioning.

### Canvas foundation

| Property | Light | Dark | Use |
|---|---|---|---|
| `--canvas-bg` | `#ffffff` | `#141a22` | Graph canvas fill |
| `--sem-node-bg` | `#ffffff` | `#1b232d` | Indicator and construct base |
| `--sem-node-stroke` | `#22242a` | `#d7dee8` | Neutral node outline |
| `--sem-label` | `#22242a` | `#e6ebf1` | Model labels |
| `--sem-edge` | `#526174` | `#a4b4c7` | Ordinary structural paths |
| `--sem-measurement-edge` | `#8b98a8` | `#8192a6` | Indicator associations |
| `--sem-selection` | `#1f5f8b` | `#5aa7d8` | Selected nodes and edges |
| `--sem-selected-fill` | `#e3eef7` | `#16314a` | Selected emphasis |
| `--sem-focus` | `#d9822b` | `#f0a457` | Active hypothesis, target or issue |
| `--sem-grid-dot` | `#dce4ee` | `#2b3645` | Background grid dots |
| `--sem-guide` | `#2a78d6` | `#79b2ec` | Snapping and alignment guide |

Keep the canvas neutral, never a gradient, and use a faint 16px dot grid at low opacity. The grid should be togglable. At high zoom levels, hide minor dots or adapt their density so the background remains calm.

### Latent construct node

**Shape:** default ellipse / softly rounded oval, visually distinct from observed indicators. Allow a clean rounded rectangle construct style as an accessibility or publication option, but do not change underlying semantics.

**Dimensions and styling:**

- Default construct: approximately `136 × 72px`, minimum `118 × 64px`; expandable to accommodate a longer name without clipping.
- Stroke: `1.5–2px` neutral, `2px` primary when selected; do not use heavy shadows.
- Fill: elevated fill; optional soft primary tint for selected construct.
- Name: 14px / 650, centered, max 2–3 lines, never crop mathematical text silently.
- Secondary detail: 11px, tabular R² or method/construct-type tag, below name or near lower edge.
- A selected construct can show a floating action bar or property handles, not a giant permanent toolbar.
- Respect label orientation and sizes in exported SVG.
- Both reflective/common-factor and composite/formative types must be discernible by **an explicit text/icon label in the inspector or small tag**. Do not imply estimator semantics by color alone.

### Observed indicator node

- Default `80 × 34px` compact rectangle (widens to fit longer names), 6px radius, 1px border, elevated/sunken neutral contrast.
- Indicator code such as `PU1`, `SYSQ_2`: 12px / 600; optional descriptive label in popover/inspector.
- Optional missing-column warning icon or status dot with accessible tooltip.
- Selected indicator: primary-soft fill and primary border.
- Stable handles on correct side facing associated construct; no visible spaghetti of connections.
- Dense mode `64 × 30px` for very large diagrams; accessibility and print legibility take priority.
- Group indicators around their latent construct with uniform spacing and no collisions.

### Scientific path semantics

| SEM relation | Visual grammar | Important behavior |
|---|---|---|
| Structural directed path | Solid `1.7–2px` line with small arrowhead | Construct → construct, estimate label offset from line |
| Reflective measurement path | Thin directed line, construct → indicator | Label standardized loading (if results enabled) |
| Formative/composite path | Thin directed line, indicator → construct | Label weight; inspector explains semantics |
| Covariance / correlated errors | Smooth curved line, double-headed arrows | CB only when method supports it |
| Hypothesis | Tiny `H1`, `H2`, ... annotation near structural path | Distinct from coefficient label, togglable |
| Non-significant structural path (results) | Same colour and width, dashed `6 4` | p ≥ .05 (or CI containing 0 when there is no p); legend says so; nothing dashed without inference |
| Unsupported relationship | Dashed warning overlay, explanatory icon | Not an analyzable edge until fixed |
| Selected/focused path | Primary or orange emphasis, width increment ≤1px | Preserve coefficient readability |
| Model diagnostics overlay | Semantic indicator + caption | Never color a statistically negative sign automatically red |

**Important:** Direction conveys meaning, not merely decoration. In PLS, arrow notation must match the validated measurement specification; in CB diagrams, a covariance edge should remain double-headed and distinct from regression.

### Edge labels and coefficient pills

- Default: white/elevated micro surface, `11–12px` tabular figures, 4px radius, subtle 1px border or no border if contrast sufficient.
- Show `0.42` by default (not `0.4200000`); detailed SE, CI and p live in tooltip/inspector.
- Optional `β = 0.42` for report exports, but preserve a consistent locale/notation.
- Place labels away from arrowheads and intersections. If edge overlaps persist, offer manual label dragging.
- On measurement edges, provide a **Show loadings / Show weights** toggle to prevent excessive clutter.
- For structural paths, **Path estimate / Bootstrap t / p / CI / Hypothesis** overlays are separate modes, never displayed simultaneously by default.
- In CB-SEM, optional **standardized / unstandardized** toggle must visibly change labels and legend.

### Results inside the modeler

- Endogenous construct may show a small R² capsule below its title (11px), colored neutral unless an assessment state justifies color.
- Prefer badge outside the ellipse if inline R² crowds the label.
- Show unsupported or non-estimated coefficients as `—`, never 0.
- Export presentation mode removes hover controls, mini-map, grid dots, edit icons, selection rectangles, and warning markers unless intentionally included.

---

## 9. Snap-to-grid, alignment and automatic layout

These controls are **central product functionality**, not optional polish.

### Grid and guides

- Default **16px grid**, alignment to 8px half-grid only if enabled; toolbar label "Snap to grid" with clear on/off state.
- When dragging, preview snap location and near-edge/center guides; guides disappear immediately on release.
- Do not accumulate rounding error across moves; store stable world coordinates.
- Shift-drag can constrain one axis; modifier behavior must be documented and not conflict with accessibility or browser shortcuts.
- `Alt/Option` bypass snapping while dragging; `Shift` constrain axis (configurable), with on-screen hint.
- Undo is one transaction per drag, not hundreds of history entries.

### Editing actions

| Action | Behavior |
|---|---|
| Align left/right/top/bottom | Use selected nodes' visible geometry |
| Align horizontal/vertical centers | Use bounding-box centers |
| Distribute horizontally/vertically | Equalize gaps between selected nodes; preserve endpoints |
| Equalize size | Optional, constrained to same node category |
| Arrange model | ELK layout using semantic hierarchy |
| Arrange indicators | Fan or stack indicator boxes consistently around parent construct |
| Mirror orientation | Re-layout left-to-right / top-to-bottom without reversing causal arrows |
| Lock position | Keep manually anchored constructs where algorithm supports it |
| Fit diagram | Compute content bounds and comfortable padding |
| Reset layout | Ask confirmation only when user-position data would be overwritten |

### Automatic layout strategy

1. Place exogenous constructs at the input edge, dependent constructs downstream.
2. Use ELK layered options with stable sorted IDs, consistent port constraints and spacing.
3. Allocate stable indicator groups around each construct. For large models, allow **collapsed indicator mode** before layout.
4. Use different edge routing and label offset policies for measurement and structural arrows.
5. Detect node intersections, label-node overlaps, significant edge crossings, and out-of-frame content; reroute or highlight unresolved violations.
6. Preserve manually pinned nodes where possible; offer "Rearrange unpinned only".
7. Produce deterministic results so rerunning layout does not shuffle the diagram unpredictably.
8. Save layout settings per project; never change numerical analysis inputs when changing layout.

### Keyboard shortcuts

`Cmd/Ctrl+Z` undo, `Shift+Cmd/Ctrl+Z` redo, `Cmd/Ctrl+A` select all when canvas focused, `Cmd/Ctrl+C` copy, `Cmd/Ctrl+V` paste, `Delete` remove selection, `G` toggle grid only when focus is not in a text field, `F` fit view, `L` auto arrange (if no collision), `?` shortcuts overlay. All shortcuts must respect active inputs, screen readers and platform conventions.

### Visual acceptance targets

- A 4–7 construct TAM diagram should have **zero node overlaps** and no unreadable structural labels after auto layout at standard canvas width.
- A 15-construct, 60-indicator model should remain manageable with indicator collapse, zoom and a useful layout strategy.
- Zoom 50–150% retains clear text and selectable handles.
- SVG export matches the canvas positions and types; no clipping.
- Mouse and keyboard flows support the same fundamental tasks.

---

## 10. Data visualization and research chart recipes

### Inherited categorical chart palette

| Token | Light | Dark |
|---|---|---|
| `--chart-1` | `#2a78d6` | `#3987e5` |
| `--chart-2` | `#eb6834` | `#d95926` |
| `--chart-3` | `#1baf7a` | `#199e70` |
| `--chart-grid` | `#e1e0d9` | `#2c2c2a` |
| `--chart-axis` | `#c3c2b7` | `#383835` |
| `--chart-muted` | `#898781` | `#898781` |
| `--chart-surface` | `#ffffff` | `#171e27` |

Use category colors to identify series, **not** to signal whether a coefficient is good/bad. Semantic colors remain reserved for errors, warnings, recommendations and confirmations. If an estimate is negative, show the minus sign, CI and a neutral/method-specific annotation; negative is not always an error.

### Generic chart rules

- Card header contains chart title, one-sentence purpose, estimator/run context and control/export menu.
- Single value axis where possible; fine grid, no gratuitous tick marks, axes labels and units.
- 2px lines, 10% alpha area fills; 4px bar corner radius, maximum 24px bar thickness.
- Default numeric precision 2–3 decimal digits (configurable); avoid `p = 0.000`.
- Tooltips adopt the card surface with 6px corners, 8px × 10px padding, 12px text, medium shadow.
- Charts must expose a synchronized accessible table.
- Colors read from theme variables; refresh with theme changes while preserving series identity.

### Dedicated statistical charts

| Visualization | Purpose | UI rule |
|---|---|---|
| Bootstrap coefficient distribution | Inference | Histogram/density with observed coefficient and CI indicators; axis labeled |
| Path estimate forest plot | Compare effects | Dot/CI horizontal display, zero reference line, tabular values |
| Construct reliability overview | Assessment | Small horizontal bars and precise labels; no mandatory arbitrary traffic light |
| HTMT heat map | Discriminant validity | Legible legend, numbers in cells, support missing/nonapplicable |
| Loadings/weights bars | Measurement model | Identify item codes; allow sorting and selection |
| CB model fit summary | Fit diagnosis | Compact table and optional confidence intervals |
| Residual correlation matrix | CB diagnostics | Neutral/diverging scale, clear zero semantics |
| Prediction scatter / residual chart | PLSpredict | Fold-level context and out-of-sample distinction |
| Group comparison | MGA/invariance | Same scale/legend, method differences disclosed |
| IPMA scatter | Managerial prioritization | Dedicated design detailed in section 11 |

---

## 11. IPMA: flagship chart composition

### Core look

IPMA should be visually iconic but restrained: a spacious, crisp scatter plot with **Performance on X (0–100)** and **Importance / Total effect on Y**. The plot may be taller than other charts and should fit both a research report and the app's analytical workspace.

**Do not default Y to 0–1.** Importance can be negative or outside that range depending on effects and model. Axis range must derive from actual results and include meaningful zero context.

### Page layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ IPMA  ·  Target: User Satisfaction ▾    [Constructs | Indicators]  [Export] │
│ Purpose / scaling and estimator details                                      │
├───────────────────────────────────────────────────┬──────────────────────────┤
│                                                   │ Selected construct       │
│     IMPORTANCE (TOTAL EFFECT)                     │ • Importance: 0.31       │
│       ↑                                           │ • Performance: 62.4/100  │
│       │  ●  Performance Expectancy                │ • Path decomposition     │
│       │                 ○ Information Quality     │ • Original item bounds   │
│       │        ● System Quality                   │ • Interpretation         │
│       └────────────────────────────────────→       │                          │
│                  PERFORMANCE (0–100)              │                          │
├───────────────────────────────────────────────────┴──────────────────────────┤
│ [Copy data table]  [Copy figure]  [Export SVG]  [Show reference lines]         │
│ Construct                       Importance      Performance        Source     │
└──────────────────────────────────────────────────────────────────────────────┘
```

This is a **layout mockup** only; example coordinates and values must be replaced by validated estimates, never shown as actual user findings.

### Plot style

- Background `--chart-surface`; 1px border, 10px radius.
- Plot area generous: 56–72px left margin, 46–56px bottom margin (adjust to labels).
- Fine grid lines with low opacity; tick labels 11px, dark contrast for text.
- Point circle diameter 10–14px, stroke ~2px. Active/selected point gets orange outline and subtle halo; inactive points are muted, not invisible.
- Category palette on points; optional direct/all predecessor groups distinguished by shape or legend, not color alone.
- Hover/keyboard focus reveal a **compact insight card** with construct name, importance (total effect), performance (0–100), target, original item scale and CI if supported.
- Implement smart point label placement: offset, overlap resolution, optional leader lines, max label density, hide labels on narrow screens with full interactive detail retained.
- Dotted reference lines optional; thresholds labeled as "Median of displayed constructs" or another explicitly chosen rule, never presented as universal standards.
- Provide **View supporting paths** button that focuses related model edges and optional decomposition of direct/indirect effects.
- Negative importance remains below zero; visually preserve signs and explanation.
- Show a small note under chart: *"Performance uses original survey scale endpoints. Importance is the total effect on the selected target."*

### Interaction

- Target construct select changes calculations and plot; for a stale or unestimated model, show a helpful empty state.
- Switch **All predecessors / Direct predecessors** and **Construct / Indicator** where supported.
- Click point → synchronized sidebar and modeler highlight.
- Click model construct → IPMA highlights corresponding point if eligible.
- Toggle annotations/CI/reference lines, copy data, export SVG/PNG with predictable dimensions.
- Make every point keyboard focusable; accessible textual summary and table equivalent.
- Selected points retain identity between theme changes and chart redraw.

### Export presets

- Presentation: 16:9 (e.g., 1600 × 900 pixels at raster export target).
- Academic figure: content-aware rectangular size with ample legend space and SVG preferred.
- Square compact figure: 1:1, simplified labels.
- Always include chart title, axes with units, method/target footnote and legend in the exported artifact, or offer a "clean figure + caption" paired export.
- SVG text should use a robust font stack or embedded outlines if necessary for portability; never ship font files as a data export.

### IPMA validation UX

If original indicator scales are missing, show a prominent **actionable** callout: "Set the permitted minimum and maximum for each indicator to calculate performance." Link to exact fields in Data Lab; **do not calculate pretend 0–100 performance from observed sample extrema**.

---

## 12. Data Lab and analysis configuration styling

### CSV import

- Drag area: elevated surface, dashed 1px strong border, 10px radius, clear `Import CSV` primary action, secondary `Use sample dataset`.
- Preview rows in a 13px dense table with sticky header; widths reflect labels but can be resized.
- Data quality top row: observations, indicators, missingness and scale types.
- Column mapping: left available columns (`280px` if room), right construct/indicator tree; highlight exact match vs suggestion distinctly.
- Error messages near the row/column affected; e.g., `PU3 contains 4 nonnumeric values` with action to inspect.
- Do not expose original CSV contents in app analytics, URLs, public sharing, or error notifications.

### Analysis configuration

- Two-pane BPMN Studio composition: 380px configuration panel, flexible preview and results.
- Method cards: **PLS-SEM** / **CB-SEM** with 2–3 lines explaining the difference, not only icons.
- Estimator select updates available toggles; unsupported features show disabled controls **with an explanation**.
- Bootstrap repetitions as numeric input plus presets, seed field, CI method, one-/two-sided rationale and execution resource estimate if available.
- Strong primary action `Run analysis`; meaningful secondary `Validate model`.
- An active job shows progress, current stage and cancel control; no decorative progress percentage if backend cannot report it.
- Show subtle **Data leaves browser for computation** notice before the first remote analysis.
- Raw R/Python output logs belong in a collapsible technical panel, not the student-facing main results.

### Analysis run header

A compact provenance line should include method, estimator, engine, dataset N, run timestamp, seed/bootstraps when used, and warnings. Use 11–12px metadata; expand for full package versions and model fingerprint. A completed status is neutral/success, but **statistical significance is not a status badge**.

---

## 13. Results, tables and Word clipboard design

### Publication-ready table geometry

- Table in elevated 1px-bordered surface, 6px radius, horizontally scrollable when necessary.
- 12px semibold header, 13px body; cells `7px 10px`; right-align numeric columns.
- Consistent decimal places, tabular numerals, missing values as en dash (with explanation), p values formatted correctly.
- Keep method and estimator in caption/footnote where needed; no ambiguous "Reliability" column without definition.
- Support **full table / selected columns / selected cells** and a row count.
- Large tables must offer frozen first column for construct/indicator names when possible.
- Use subtle row hover, not rainbow scientific significance heatmaps by default.

### One-click editable paste into DOCX

`Copy table` is a principal action in every table toolbar. It should copy **`text/html` semantic table markup** (simple inline borders, font sizes, left/right alignment, one header row and standard cells) and **`text/plain` TSV fallback** via the secure clipboard API.

Required UX:

1. User clicks `Copy table`.
2. Show toast: `Table copied — paste into Word or Google Docs` on successful rich HTML copy.
3. If only plain text could be copied, explicitly say `Copied as text; table formatting may not be preserved`.
4. Include column headers and an optional caption/footnotes selected in the copy menu.
5. Test pasting into Microsoft Word desktop/web and Google Docs on supported browsers before claiming compatibility.
6. Escape/sanitize imported labels to prevent HTML/script injection.
7. Prefer no merged cells for basic scientific tables, so Word editing stays reliable.

In the browser, an editable HTML table is different from copying a figure image; offer **Copy figure** separately. Display a small clipboard icon near every table title plus explicit toolbar label for discoverability.

### SEM results information hierarchy

```text
Run provenance / warnings
    ↓
Summary (sample, estimator, outcomes)
    ↓
[Measurement] [Structural] [Bootstrap] [Fit] [Prediction] [IPMA]
    ↓
Table or figure with method notes
    ↓
"Explain this result" / Next check / Copy & Export
```

- For reflective vs formative criteria, show only applicable measures.
- In CB results, fit summaries are a different category from coefficient significance.
- **No red/green "hypothesis accepted" automation**. Tests need confidence intervals and an interpretation, not a binary colored story.

### Figure and report output

- `Export SVG` default for diagram/vector research assets; PNG for presentations, user-configurable 2×/3×/300 dpi-equivalent pixel size (state physical dimensions and pixel count when offering DPI).
- Figures use opaque white or transparent background option, respecting publication constraints even if UI theme is dark.
- `Copy caption` includes variable names, method/estimator, sample and relevant caveat; user may edit it.
- `Copy methodological statement` provides non-misleading provenance, not an automatically written scientific conclusion.

---

## 14. Learn, challenges and Colab visual treatment

### Learn

Use the inherited reference-content composition: **280px sticky lesson index + flexible article, 24px gap**. Keep one active concept, a miniature interactive diagram, 2–4 small paragraphs, and a clear next action. White space should be moderate, with the same compact headings and muted labels as BPMN Studio.

Every learning module has a standard recipe:

- Concept and practical relevance.
- Interactive mini model / focused chart.
- Mathematical definition or intuitive formula as appropriate.
- Common mistake (warning callout).
- "Try it" action that copies a starter model into a sandbox.
- Knowledge check with explainable feedback.

### Challenges

- Cards for **Model**, **Diagnose**, **Analyze**, **Interpret**, **Report**; tag by PLS/CB, difficulty and lesson prerequisite.
- Preserve BPMN Studio's subtle card surfaces, compact chips, progress tracking and actionable error explanations.
- Challenge workspace reuses the same modeler or results view; avoid a second simplified graph editor.
- Keep scoring feedback as text plus accessible icon, not just success/error coloring.
- Progressive hints do not reveal the final answer immediately; allow self-assessment and retries.

### Five Python Colab examples

- Present five clean example cards with a small **model diagram preview**, theory name, method chip, learning objective, and `Open in Colab` action.
- The examples are TAM, ACSI-inspired, DeLone & McLean IS Success, UTAUT2-inspired, and service quality CB-SEM.
- Each card clearly states **synthetic teaching data** unless a real licensed dataset is provided.
- For features that aren't available in the Python library, show "R implementation required" or "Not implemented in this notebook" rather than a false toggle.
- Keep the notebook link disabled until there is a valid hosted `.ipynb` URL; the user can download the notebook file locally once implemented.
- Use one consistent figure style in notebook-generated diagrams so Colab examples feel part of SEM Lab.

---

## 15. Dark mode, motion and accessibility

The **theme contract** is identical to BPMN Studio: `light`, `dark`, `system` preference; apply resolved `data-theme="light"` or `data-theme="dark"` to the root. Keep canvas, React Flow controls, tables, chart tooltips, dialogs, Monaco/CodeMirror (if used), and SVG outputs explicitly themed together.

### Motion

| Interaction | Timing target |
|---|---|
| Button hover / selected state | 120ms |
| Card hover border/shadow | 120ms |
| Toast entry | 180ms ease-out, 8px rise |
| Progress width | 250ms when progress is real |
| Loading spinner | 1s linear |
| Node selection | 100–120ms subtle outline |
| Auto layout transition | 180–240ms only if model remains trackable |
| IPMA point hover/focus | 100–150ms subtle change |

Honor `prefers-reduced-motion: reduce`; disable decorative graph transitions and use instantaneous position changes when requested. Never animate statistical values in a way that misstates analysis progress.

### Accessibility requirements

- Visible keyboard focus ring, skip-to-content, labeled navigation, dialog focus trap and return focus.
- Tabs support proper keyboard arrow navigation, active panel labels and state.
- Each diagram element is discoverable in an accessible model list/tree; do not assume canvas drag-and-drop is accessible.
- Focusable IPMA points and a full linked data table provide a nonvisual equivalent.
- Chart legends and values not communicated by color only.
- Use 4.5:1 target for body text, and verified contrast for diagrams; test both themes with real data.
- Icon-only controls always have accessible labels; controls in dense toolbars have tooltips.
- At narrow widths, data tables scroll horizontally without trapping keyboard focus.
- Warn for low screen space; a touch device may use inspector-below-canvas mode rather than pretending desktop research editing is comfortable on 320px.

---

## 16. Implementation CSS tokens (copy these into the theme layer)

The following expresses the central **BPMN Studio** palette and the new SEM diagram additions. If project CSS already has tokens, consolidate carefully and do not create conflicting parallel theme systems.

```css
:root,
[data-theme="light"] {
  color-scheme: light;
  --font-sans: 'Inter', 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --bg: #f4f6f9;
  --bg-elevated: #ffffff;
  --bg-subtle: #eef1f5;
  --bg-sunken: #e6eaf0;
  --bg-hover: #e9eef5;
  --border: #d6dce5;
  --border-strong: #b7c1cf;
  --text: #17202c;
  --text-muted: #4b5867;
  --text-subtle: #6b7787;
  --text-on-primary: #ffffff;
  --primary: #1f5f8b;
  --primary-hover: #184d72;
  --primary-soft: #e3eef7;
  --primary-strong: #123b59;
  --accent: #d9822b;
  --accent-soft: #fbeedd;
  --error: #c0392b;
  --error-soft: #fbe9e7;
  --warning: #b7791f;
  --warning-soft: #fdf3dc;
  --recommendation: #2b6cb0;
  --recommendation-soft: #e6f0fa;
  --info: #5a6779;
  --info-soft: #eef1f5;
  --success: #2f855a;
  --success-soft: #e3f4ea;
  --radius-sm: 6px;
  --radius: 10px;
  --radius-lg: 14px;
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.06);
  --shadow: 0 2px 8px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.06);
  --shadow-lg: 0 12px 32px rgba(16, 24, 40, 0.16);
  --focus-ring: 0 0 0 3px rgba(31, 95, 139, 0.35);
  --chart-1: #2a78d6;
  --chart-2: #eb6834;
  --chart-3: #1baf7a;
  --chart-grid: #e1e0d9;
  --chart-axis: #c3c2b7;
  --chart-muted: #898781;
  --chart-surface: #ffffff;
  --canvas-bg: #ffffff;
  --sem-node-bg: #ffffff;
  --sem-node-stroke: #22242a;
  --sem-label: #22242a;
  --sem-edge: #526174;
  --sem-measurement-edge: #8b98a8;
  --sem-selection: #1f5f8b;
  --sem-selected-fill: #e3eef7;
  --sem-focus: #d9822b;
  --sem-grid-dot: #dce4ee;
  --sem-guide: #2a78d6;
}

[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f141b;
  --bg-elevated: #171e27;
  --bg-subtle: #1c2430;
  --bg-sunken: #121821;
  --bg-hover: #233042;
  --border: #2b3645;
  --border-strong: #3b4a5e;
  --text: #e6ebf1;
  --text-muted: #b2bdcb;
  --text-subtle: #8a97a8;
  --text-on-primary: #0b1520;
  --primary: #5aa7d8;
  --primary-hover: #7ab9e3;
  --primary-soft: #16314a;
  --primary-strong: #a8d3ef;
  --accent: #f0a457;
  --accent-soft: #3a2a17;
  --error: #f2776a;
  --error-soft: #3b1d1a;
  --warning: #e8b45a;
  --warning-soft: #3a2d14;
  --recommendation: #79b2ec;
  --recommendation-soft: #172a40;
  --info: #a3afbf;
  --info-soft: #1f2833;
  --success: #6fcf97;
  --success-soft: #16301f;
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.06);
  --shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.6);
  --focus-ring: 0 0 0 3px rgba(90, 167, 216, 0.45);
  --chart-1: #3987e5;
  --chart-2: #d95926;
  --chart-3: #199e70;
  --chart-grid: #2c2c2a;
  --chart-axis: #383835;
  --chart-muted: #898781;
  --chart-surface: #171e27;
  --canvas-bg: #141a22;
  --sem-node-bg: #1b232d;
  --sem-node-stroke: #d7dee8;
  --sem-label: #e6ebf1;
  --sem-edge: #a4b4c7;
  --sem-measurement-edge: #8192a6;
  --sem-selection: #5aa7d8;
  --sem-selected-fill: #16314a;
  --sem-focus: #f0a457;
  --sem-grid-dot: #2b3645;
  --sem-guide: #79b2ec;
}
```

### Example SEM node styles

```css
.sem-canvas {
  background: var(--canvas-bg);
  color: var(--sem-label);
}
.sem-construct {
  min-width: 118px;
  min-height: 64px;
  padding: 12px 18px;
  border: 2px solid var(--sem-node-stroke);
  border-radius: 50%;
  display: grid;
  place-items: center;
  text-align: center;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 650;
  background: var(--sem-node-bg);
  color: var(--sem-label);
}
.sem-construct[data-selected="true"] {
  background: var(--sem-selected-fill);
  border-color: var(--sem-selection);
  box-shadow: var(--focus-ring);
}
.sem-indicator {
  min-width: 118px;
  min-height: 34px;
  padding: 5px 9px;
  border: 1px solid var(--sem-node-stroke);
  border-radius: 6px;
  background: var(--sem-node-bg);
  color: var(--sem-label);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}
.sem-grid-guide { stroke: var(--sem-guide); stroke-width: 1; stroke-dasharray: 3 3; }
.sem-coefficient { font-variant-numeric: tabular-nums; font-size: 11px; }
@media (prefers-reduced-motion: reduce) {
  .sem-canvas *, .ipma-chart * { transition-duration: 0ms !important; animation-duration: 0ms !important; }
}
```

The CSS is a **starting point**, not a complete React Flow implementation. Use React Flow's custom node lifecycle and handles; do not render `border-radius: 50%` on oversized labels without testing clipping. Consider SVG elliptical shapes when precise academic exports are required.

---

## 17. Quality gates and transfer checklist

### Fidelity to BPMN Studio

- [ ] Theme tokens match the original BPMN Studio design language exactly for shared colors, typography, spacing, buttons, cards and shell.
- [ ] Light/dark modes both styled completely; no default React Flow white islands in dark mode.
- [ ] Body 14px, input 34px, small buttons 28px, card radius 10px, inspector 420px desktop.
- [ ] Minimal shadows and thin borders; no glossy, glassmorphism or marketing-style hero components in the research workspace.
- [ ] All tooltip, toast, dialog, tab and form states implemented consistently.

### SEM diagram quality

- [ ] Reflective, formative and covariance relationships are visually and semantically distinct.
- [ ] Grid snapping, selection, center/edge alignment and spacing commands behave correctly.
- [ ] Auto layout produces a clean TAM, D&M and larger constructed model without cut-off labels.
- [ ] Displaying coefficients does not obscure arrows or source indicator names.
- [ ] SVG and PNG export match model positions and remain legible.
- [ ] Long construct names, 3-digit indicators, overlapping edges and responsive modes tested.

### Statistical/reporting integrity

- [ ] Colors never equate significance with scientific quality by default.
- [ ] IPMA displays original-scale performance 0–100 and true total-effect importance, including negative values.
- [ ] Missing original scale bounds prevent calculation with actionable error.
- [ ] Bootstrap figure has correct confidence interval metadata and axis labels.
- [ ] Word copied table retains editable rows/columns in supported clients, with secure clipboard text fallback.
- [ ] Table precision, units, estimator, sample and p-value notation are consistent.
- [ ] Unsupported method features display honest limitations, never fake results.

### Accessibility and performance

- [ ] Keyboard access, screen reader route through model list, IPMA data table, focus trap, reduced motion, 4.5:1 contrast target.
- [ ] 50+ constructs or large indicator maps remain usable through collapse and viewport strategies.
- [ ] Dataset privacy notice appears before remote processing; no imported row data is logged.
- [ ] Both Netlify frontend and Railway analysis UI show sensible disconnected/loading/error states.

### Suggested project file map

| Project file | Responsibilities |
|---|---|
| `src/styles/tokens.css` | All shared light/dark design tokens |
| `src/styles/global.css` | Reset, typography, shell and reusable surfaces |
| `src/styles/sem-modeler.css` | React Flow node/edge variants, guides, inspector |
| `src/styles/analysis.css` | Data Lab, configuration, run states, tables |
| `src/styles/ipma.css` | Specialized scatter, legends, responsive inspector |
| `src/components/ui/` | Shared buttons, cards, dialogs, tabs, tooltips |
| `src/features/modeler/` | Semantic React Flow editor and layout controls |
| `src/features/results/` | Tables, clipboard, exports, provenance |
| `src/features/ipma/` | Plot, point inspector, table sync |
| `src/app/theme.tsx` | `system` / `light` / `dark` preference and resolution |

Paths are **recommended**, not guaranteed to match the project's eventual repository structure. If using a monorepo (`apps/web/src`), place these folders under that application's source tree.

### One-paragraph visual brief for agents

> **Design SEM Lab as a compact academic research workspace using BPMN Studio's cool-neutral surfaces, thin borders, Inter-style 14px body typography, 6px controls, 10px cards, blue primary actions, subtle orange emphasis, Lucide outline icons and complete light/dark themes. Give the React Flow path-model editor exceptional precision: clean elliptical constructs, compact rectangular indicators, correct arrows, 16px grid snapping, smart guides, deterministic automatic layout and publication-ready SVG export. Keep quantitative results calm and precise, tables genuinely editable when pasted into Word, and the IPMA view a spacious, highly legible importance–performance scatter plot with clear target, axis definitions, supporting data and uncertainty.**

