import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { CircleDot, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Dialog, Kbd, SegmentedControl, useToast } from '@/components/ui';
import { useProjectRuns } from '@/features/analysis/runs';
import { useReadiness } from '@/features/data-lab/readiness';
import {
  loadProject,
  PROJECT_FILE_EXTENSION,
  parseProjectFile,
  toProjectFile,
} from '@/storage/projects';
import { SemCanvas } from './canvas/SemCanvas';
import { CHECK_PANEL_ID, CheckPanel } from './CheckPanel';
import { sceneToSvg, svgToPng } from './export/svg-export';
import { useFocusRequest } from './focus';
import { IndicatorPalette } from './IndicatorPalette';
import { Inspector } from './Inspector';
import { computeAutoLayout } from './layout/auto-layout';
import { ModelerToolbar } from './ModelerToolbar';
import { useResultStyle } from '@/features/results/store';
import { type OverlayInput, type OverlayMode, hasBothScales, overlayLegend } from './overlay';
import { buildScene } from './scene';
import { emptyLayout, useModeler } from './store';
import { TEMPLATES } from './templates';
import { readLastProjectId, useAutosave } from './useAutosave';
import { usePanelState } from './usePanelState';
import './modeler-page.css';

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/Cmd + Z', 'Undo'],
  ['Shift + Ctrl/Cmd + Z', 'Redo'],
  ['Ctrl/Cmd + A', 'Select all'],
  ['Ctrl/Cmd + C / X / V', 'Copy, cut, paste'],
  ['Delete', 'Delete selection'],
  ['Shift + drag', 'Lasso selection (on empty canvas) · constrain axis (on a node)'],
  ['Alt/Option + drag', 'Move without snapping'],
  ['G', 'Cycle grid: dots / faint / hidden'],
  ['F', 'Fit diagram'],
  ['L', 'Arrange model (keeps pinned constructs)'],
  ['Escape', 'Clear selection'],
  ['?', 'This list'],
];

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeFileName = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'sem-model';

/**
 * The project the user chose to start blank (Blank canvas or New model). Kept outside the
 * component so an empty blank project stays a canvas after leaving the Modeler and coming back,
 * instead of falling back to the template picker.
 */
let blankProjectId: string | null = null;

function StartScreen({ onOpenFile, onBlank }: { onOpenFile: () => void; onBlank: () => void }) {
  const rf = useReactFlow();
  const start = async (
    build: () => ReturnType<(typeof TEMPLATES)[number]['build']>,
    name: string,
  ): Promise<void> => {
    const model = build();
    const layout = emptyLayout();
    const { positions } = await computeAutoLayout(model, layout.settings);
    const st = useModeler.getState();
    st.newProject(name);
    st.edit(
      () => model,
      () => ({ ...layout, nodes: positions }),
    );
    // a fresh project starts with an empty history: the template is the starting point, not an edit
    useModeler.setState({ past: [], future: [] });
    window.setTimeout(() => void rf.fitView({ padding: 0.15 }), 50);
  };
  return (
    <div className="modeler-start">
      <h2>Start a model</h2>
      <p className="modeler-start-lead">
        Begin from a published theory, add constructs one by one, or open a saved project file.
      </p>
      <div className="modeler-start-grid">
        {TEMPLATES.map((t) => (
          <Card key={t.id} className="modeler-start-card">
            <h3>{t.title}</h3>
            <p>{t.description}</p>
            <p className="modeler-start-citation">{t.citation}</p>
            <Button
              variant="primary"
              size="small"
              onClick={() => void start(() => t.build(), t.title)}
            >
              Use template
            </Button>
          </Card>
        ))}
      </div>
      <div className="modeler-start-actions">
        <Button
          icon={<CircleDot size={16} />}
          onClick={() => {
            useModeler.getState().newProject('Untitled model');
            onBlank();
          }}
        >
          Blank canvas
        </Button>
        <Button icon={<FolderOpen size={16} />} onClick={onOpenFile}>
          Open project file…
        </Button>
      </div>
    </div>
  );
}

function ModelerWorkspace() {
  const [connectKind, setConnectKind] = useState<'path' | 'covariance'>('path');
  const [{ paletteOpen, paletteWidth, inspectorOpen, inspectorWidth }, setPanels] = usePanelState();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const readiness = useReadiness(undefined);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('none');
  const scale = useResultStyle((s) => s.scale);
  const { current: currentRun } = useProjectRuns();
  const currentResult = currentRun?.record.result;
  const overlay: OverlayInput | null =
    currentResult && overlayMode !== 'none'
      ? { mode: overlayMode, result: currentResult, scale }
      : null;
  const projectId = useModeler((s) => s.projectId);
  const [blankId, setBlankId] = useState(blankProjectId);
  const startBlank = (): void => {
    const id = useModeler.getState().projectId;
    blankProjectId = id;
    setBlankId(id);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const isEmpty = useModeler(
    (s) => s.model.constructs.length === 0 && s.model.indicators.length === 0,
  );
  const save = useAutosave();
  const focusRequest = useFocusRequest((s) => s.request);
  const focusedIds = useMemo(
    () => (focusRequest ? new Set(focusRequest.ids) : undefined),
    [focusRequest],
  );
  // A focus request (e.g. IPMA "View supporting paths") selects its elements once.
  useEffect(() => {
    if (focusRequest) useModeler.getState().select(focusRequest.ids);
  }, [focusRequest]);

  // Re-open the last project on first visit.
  useEffect(() => {
    const id = readLastProjectId();
    if (!id || useModeler.getState().model.constructs.length > 0) return;
    loadProject(id)
      .then((p) => p && useModeler.getState().load(p))
      .catch(() => toast({ title: 'The last project could not be opened', variant: 'warning' }));
  }, [toast]);

  // The template picker is for a first visit; a project started blank stays a canvas.
  const showStart = isEmpty && blankId !== projectId;

  const openFile = (): void => fileInput.current?.click();
  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const result = parseProjectFile(await file.text());
    if (!result.ok) {
      toast({ title: 'Could not open the project', description: result.error, variant: 'error' });
      return;
    }
    useModeler.getState().load(result.project);
    toast({ title: `Opened “${result.project.name}”`, variant: 'success' });
  };

  const exportAs = async (kind: 'svg' | 'png2' | 'png3' | 'project'): Promise<void> => {
    const s = useModeler.getState();
    const base = safeFileName(s.projectName);
    if (kind === 'project') {
      download(
        `${base}${PROJECT_FILE_EXTENSION}`,
        new Blob([toProjectFile(s.toProject(new Date().toISOString()), new Date().toISOString())], {
          type: 'application/json',
        }),
      );
      toast({
        title: 'Project file downloaded',
        description: 'It contains the model and layout only — no data.',
        variant: 'success',
      });
      return;
    }
    const svg = sceneToSvg(buildScene(s.model, s.layout, { overlay }), {
      background: 'white',
      title: s.projectName,
    });
    if (kind === 'svg') {
      download(`${base}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
      return;
    }
    const scale = kind === 'png2' ? 2 : 3;
    try {
      download(`${base}@${scale}x.png`, await svgToPng(svg, scale));
    } catch (e) {
      toast({
        title: 'PNG export failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'error',
      });
    }
  };

  // Pane widths resize by dragging the divider: the palette's right edge grows with rightward
  // movement; the inspector's left edge grows with leftward movement (hence `- dx`).
  const resizePalette = (dx: number): void =>
    setPanels((p) => ({ paletteWidth: Math.min(520, Math.max(200, p.paletteWidth + dx)) }));
  const resizeInspector = (dx: number): void =>
    setPanels((p) => ({ inspectorWidth: Math.min(640, Math.max(300, p.inspectorWidth - dx)) }));

  const RAIL = '44px';
  const bodyColumns = [
    showStart ? null : paletteOpen ? `${paletteWidth}px` : RAIL,
    'minmax(0, 1fr)',
    inspectorOpen ? `${inspectorWidth}px` : RAIL,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="modeler"
      data-palette={paletteOpen && !showStart ? 'open' : 'closed'}
      data-inspector={inspectorOpen ? 'open' : 'closed'}
      data-check={checkOpen ? 'open' : 'closed'}
    >
      <h1 className="sr-only">Modeler</h1>
      <ModelerToolbar
        connectKind={connectKind}
        onConnectKind={setConnectKind}
        onExport={(k) => void exportAs(k)}
        onOpenFile={openFile}
        onNew={() => setNewOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        checkOpen={checkOpen}
        onToggleCheck={() => setCheckOpen((o) => !o)}
        checkCounts={readiness.counts}
        checkPanelId={CHECK_PANEL_ID}
        overlay={overlay ? overlayMode : 'none'}
        onOverlay={setOverlayMode}
        overlayAvailable={currentResult !== undefined}
      />
      {save.status === 'error' || focusRequest ? (
        <div className="modeler-statusrow">
          {save.status === 'error' ? (
            <span className="modeler-save-error" role="status">
              Not saved: {save.message}
            </span>
          ) : null}
          {focusRequest ? (
            <span className="modeler-focus" role="status">
              {focusRequest.reason}
              <Button size="small" onClick={() => useFocusRequest.getState().clear()}>
                Clear focus
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
      {overlay ? (
        <div className="modeler-legend" role="note" aria-label="Overlay legend">
          {hasBothScales(overlay.result) && overlay.mode === 'estimate' ? (
            <SegmentedControl
              aria-label="Estimate scale"
              size="small"
              value={scale}
              onChange={(v) => useResultStyle.getState().set({ scale: v })}
              options={[
                { value: 'standardized', label: 'Standardized' },
                { value: 'unstandardized', label: 'Unstandardized' },
              ]}
            />
          ) : null}
          <span className="modeler-legend__text">{overlayLegend(overlay)}</span>
        </div>
      ) : null}
      {checkOpen && <CheckPanel readiness={readiness} onClose={() => setCheckOpen(false)} />}
      <div className="modeler-body" style={{ gridTemplateColumns: bodyColumns }}>
        {!showStart && (
          <IndicatorPalette
            collapsed={!paletteOpen}
            onToggle={() => setPanels((p) => ({ paletteOpen: !p.paletteOpen }))}
            onResize={resizePalette}
          />
        )}
        <div className="modeler-canvas-wrap">
          {showStart ? (
            <StartScreen onOpenFile={openFile} onBlank={startBlank} />
          ) : (
            <SemCanvas
              connectKind={connectKind}
              showHypotheses={overlay === null}
              overlay={overlay}
              showMiniMap={false}
              {...(focusedIds ? { focusedIds } : {})}
              onRequestShortcuts={() => setShortcutsOpen(true)}
            />
          )}
        </div>
        <Inspector
          collapsed={!inspectorOpen}
          onToggle={() => setPanels((p) => ({ inspectorOpen: !p.inspectorOpen }))}
          onResize={resizeInspector}
        />
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        width={520}
      >
        <table className="modeler-shortcuts">
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <Kbd>{k}</Kbd>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="inspector-hint">Shortcuts do nothing while you are typing in a field.</p>
      </Dialog>
      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Start a new model?"
        description="The current model is saved in this browser and stays in Recent projects."
        width={480}
        footer={
          <>
            <Button onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                useModeler.getState().newProject('Untitled model');
                startBlank();
                setNewOpen(false);
              }}
            >
              New model
            </Button>
          </>
        }
      />
    </div>
  );
}

export function ModelerPage() {
  return (
    <ReactFlowProvider>
      <ModelerWorkspace />
    </ReactFlowProvider>
  );
}
