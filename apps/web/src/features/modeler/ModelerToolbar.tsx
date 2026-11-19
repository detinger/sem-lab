import { useReactFlow } from '@xyflow/react';
import {
  ArrowRightLeft,
  CircleDot,
  Download,
  ListChecks,
  FilePlus2,
  FolderOpen,
  Grid3x3,
  Keyboard,
  LayoutGrid,
  Magnet,
  Maximize,
  Redo2,
  Spline,
  Undo2,
  Workflow,
} from 'lucide-react';
import {
  Badge,
  Button,
  IconButton,
  Menu,
  SegmentedControl,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from '@/components/ui';
import { addConstruct } from '@/domain/model-ops';
import { OVERLAY_LABELS, type OverlayMode } from './overlay';
import { placementFor, useModeler } from './store';

export interface ModelerToolbarProps {
  connectKind: 'path' | 'covariance';
  onConnectKind: (k: 'path' | 'covariance') => void;
  onExport: (kind: 'svg' | 'png2' | 'png3' | 'project') => void;
  onOpenFile: () => void;
  onNew: () => void;
  onShortcuts: () => void;
  /** "Check model" panel: open state, toggle and the issue counts shown in the badge */
  checkOpen: boolean;
  onToggleCheck: () => void;
  checkCounts: { error: number; warning: number };
  checkPanelId: string;
  /** result overlay selector: shown only when the project has a current complete run */
  overlay: OverlayMode;
  onOverlay: (m: OverlayMode) => void;
  overlayAvailable: boolean;
}

export function ModelerToolbar({
  connectKind,
  onConnectKind,
  onExport,
  onOpenFile,
  onNew,
  onShortcuts,
  checkOpen,
  onToggleCheck,
  checkCounts,
  checkPanelId,
  overlay,
  onOverlay,
  overlayAvailable,
}: ModelerToolbarProps) {
  const rf = useReactFlow();
  const canUndo = useModeler((s) => s.past.length > 0);
  const canRedo = useModeler((s) => s.future.length > 0);
  const settings = useModeler((s) => s.layout.settings);
  const hasModel = useModeler((s) => s.model.constructs.length > 0);
  const s = useModeler.getState;

  const addConstructAtCenter = (): void => {
    const el = document.querySelector('.sem-canvas');
    const box = el?.getBoundingClientRect();
    const at = box
      ? rf.screenToFlowPosition({
          x: box.left + box.width / 2 - 68,
          y: box.top + box.height / 2 - 36,
        })
      : undefined;
    let id = '';
    s().edit(
      (m) => {
        const r = addConstruct(m, { name: `LV${m.constructs.length + 1}` });
        id = r.id;
        return r.model;
      },
      (l) => ({ ...l, nodes: { ...l.nodes, [id]: placementFor(l, at) } }),
    );
    s().select([id]);
  };

  const fit = (): void => void rf.fitView({ padding: 0.15, duration: 200 });
  const arrange = (): void => void s().autoArrange({ keepPinned: true }).then(fit);

  return (
    <Toolbar aria-label="Modeler tools" className="modeler-toolbar">
      <ToolbarGroup>
        <Menu
          label="File"
          size="small"
          icon={<FilePlus2 size={16} />}
          items={[
            { id: 'new', label: 'New model…', icon: <FilePlus2 size={14} />, onSelect: onNew },
            {
              id: 'open',
              label: 'Open project file…',
              icon: <FolderOpen size={14} />,
              onSelect: onOpenFile,
            },
            {
              id: 'save',
              label: 'Download project file',
              icon: <Download size={14} />,
              onSelect: () => onExport('project'),
              disabled: !hasModel,
            },
          ]}
        />
        <Button
          size="small"
          variant="primary"
          icon={<CircleDot size={16} />}
          onClick={addConstructAtCenter}
        >
          Add construct
        </Button>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <SegmentedControl
          aria-label="Connection type"
          size="small"
          value={connectKind}
          onChange={onConnectKind}
          options={[
            { value: 'path', label: 'Path', icon: <Workflow size={14} /> },
            { value: 'covariance', label: 'Covariance', icon: <Spline size={14} /> },
          ]}
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <IconButton
          size="small"
          aria-label="Undo (Ctrl/Cmd+Z)"
          disabled={!canUndo}
          onClick={() => s().undo()}
        >
          <Undo2 size={16} />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Redo (Shift+Ctrl/Cmd+Z)"
          disabled={!canRedo}
          onClick={() => s().redo()}
        >
          <Redo2 size={16} />
        </IconButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <Button
          size="small"
          icon={<LayoutGrid size={16} />}
          onClick={arrange}
          disabled={!hasModel}
          title="Arrange model (L)"
        >
          Arrange
        </Button>
        <Menu
          label={
            { LR: 'L→R', RL: 'R→L', TB: 'T→B', BT: 'B→T' }[settings.direction]
          }
          size="small"
          icon={<ArrowRightLeft size={14} />}
          items={(['LR', 'RL', 'TB', 'BT'] as const).map((d) => ({
            id: d,
            label: {
              LR: 'Left to right',
              RL: 'Right to left',
              TB: 'Top to bottom',
              BT: 'Bottom to top',
            }[d],
            onSelect: () => {
              s().setLayoutSettings({ direction: d });
              arrange();
            },
          }))}
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <IconButton
          size="small"
          variant={settings.snapToGrid ? 'selected' : 'ghost'}
          aria-label={`Snap to grid: ${settings.snapToGrid ? 'on' : 'off'} (hold Alt to bypass)`}
          aria-pressed={settings.snapToGrid}
          onClick={() => s().setLayoutSettings({ snapToGrid: !settings.snapToGrid })}
        >
          <Magnet size={16} />
        </IconButton>
        <IconButton
          size="small"
          aria-label={`Grid: ${settings.gridVisibility} (G)`}
          onClick={() => {
            const order = ['dots', 'faint', 'hidden'] as const;
            s().setLayoutSettings({
              gridVisibility: order[(order.indexOf(settings.gridVisibility) + 1) % 3]!,
            });
          }}
        >
          <Grid3x3 size={16} />
        </IconButton>
        <IconButton size="small" aria-label="Fit diagram (F)" onClick={fit}>
          <Maximize size={16} />
        </IconButton>
      </ToolbarGroup>
      <div className="modeler-toolbar-spacer" />
      {overlayAvailable && (
        <ToolbarGroup>
          <SegmentedControl
            aria-label="Results overlay"
            size="small"
            value={overlay}
            onChange={onOverlay}
            options={(Object.keys(OVERLAY_LABELS) as OverlayMode[]).map((m) => ({
              value: m,
              label: OVERLAY_LABELS[m],
            }))}
          />
        </ToolbarGroup>
      )}
      <ToolbarGroup>
        <Button
          size="small"
          variant={checkOpen ? 'selected' : 'default'}
          icon={<ListChecks size={16} />}
          aria-expanded={checkOpen}
          aria-controls={checkOpen ? checkPanelId : undefined}
          onClick={onToggleCheck}
        >
          Check model
          {checkCounts.error + checkCounts.warning > 0 ? (
            <Badge variant={checkCounts.error > 0 ? 'error' : 'warning'}>
              {checkCounts.error + checkCounts.warning}
              <span className="sr-only">
                {' '}
                {checkCounts.error} errors, {checkCounts.warning} warnings
              </span>
            </Badge>
          ) : null}
        </Button>
        <Menu
          label="Export"
          size="small"
          align="end"
          icon={<Download size={14} />}
          items={[
            {
              id: 'svg',
              label: 'Diagram as SVG',
              disabled: !hasModel,
              onSelect: () => onExport('svg'),
            },
            {
              id: 'png2',
              label: 'Diagram as PNG (2×)',
              disabled: !hasModel,
              onSelect: () => onExport('png2'),
            },
            {
              id: 'png3',
              label: 'Diagram as PNG (3×, print)',
              disabled: !hasModel,
              onSelect: () => onExport('png3'),
            },
            {
              id: 'project',
              label: 'Project file (.semstudio.json)',
              disabled: !hasModel,
              onSelect: () => onExport('project'),
            },
          ]}
        />
        <IconButton size="small" aria-label="Keyboard shortcuts (?)" onClick={onShortcuts}>
          <Keyboard size={16} />
        </IconButton>
      </ToolbarGroup>
    </Toolbar>
  );
}
