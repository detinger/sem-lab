import { FileText, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  IconButton,
  Spinner,
  useToast,
} from '@/components/ui';
import { useRuns } from '@/features/analysis/runs';
import { useDataLab } from '@/features/data-lab/store';
import {
  clearWorkspaceData,
  deleteProjectAndRuns,
  listProjects,
  loadProject,
  type StoredProject,
} from '@/storage/projects';

import { useModeler } from './store';
import { LAST_PROJECT_KEY } from './useAutosave';
import './recent-projects.css';

type ProjectMeta = Omit<StoredProject, 'project'>;
type ListState =
  { status: 'loading' } | { status: 'ready'; projects: ProjectMeta[] } | { status: 'error' };

function rememberLastProject(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(LAST_PROJECT_KEY);
    else localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    /* storage may be unavailable (private mode); the project still opens for this session */
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '–'
    : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Projects autosaved in this browser's IndexedDB, newest first, each one a click from the Modeler. */
export function RecentProjects() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const openId = useModeler((s) =>
    s.model.constructs.length > 0 || s.model.indicators.length > 0 ? s.projectId : null,
  );
  const navigate = useNavigate();
  const { toast } = useToast();

  const refresh = useCallback(() => {
    listProjects()
      .then((projects) => setState({ status: 'ready', projects }))
      .catch(() => setState({ status: 'error' }));
  }, []);

  useEffect(refresh, [refresh]);

  const open = async (meta: ProjectMeta): Promise<void> => {
    if (meta.id !== openId) {
      try {
        const project = await loadProject(meta.id);
        if (!project) throw new Error('missing');
        useModeler.getState().load(project);
      } catch {
        toast({ title: `“${meta.name}” could not be opened`, variant: 'error' });
        refresh();
        return;
      }
    }
    rememberLastProject(meta.id);
    void navigate('/modeler');
  };

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    const meta = toDelete;
    setToDelete(null);
    try {
      await deleteProjectAndRuns(meta.id);
    } catch {
      toast({ title: `“${meta.name}” could not be deleted`, variant: 'error' });
      return;
    }
    if (meta.id === useModeler.getState().projectId) {
      // Otherwise the next edit would autosave the deleted project straight back.
      useModeler.getState().newProject('Untitled model');
      rememberLastProject(null);
    }
    toast({ title: `Deleted “${meta.name}”`, variant: 'success' });
    refresh();
  };

  const clearAll = async (): Promise<void> => {
    setConfirmClear(false);
    try {
      await clearWorkspaceData();
    } catch {
      toast({ title: 'Saved data could not be cleared', variant: 'error' });
      refresh();
      return;
    }
    // Drop what is still held in memory too, or autosave would write the open project back.
    useModeler.getState().newProject('Untitled model');
    useDataLab.getState().clear();
    useRuns.setState({ projectId: null, runs: [], selectedRunId: null });
    rememberLastProject(null);
    toast({ title: 'All projects and data cleared', variant: 'success' });
    refresh();
  };

  const hasProjects = state.status === 'ready' && state.projects.length > 0;

  return (
    <Card>
      <CardHeader
        title="Saved in this browser"
        level={3}
        action={
          hasProjects ? (
            <Button
              size="small"
              variant="ghost"
              icon={<Trash2 />}
              onClick={() => setConfirmClear(true)}
            >
              Clear all
            </Button>
          ) : null
        }
      />
      {state.status === 'loading' ? (
        <div className="recent-projects__loading">
          <Spinner label="Loading projects" />
        </div>
      ) : hasProjects ? (
        <ul className="recent-projects" aria-label="Saved projects">
          {state.projects.map((p) => (
            <li key={p.id} className="recent-projects__row">
              <button type="button" className="recent-projects__open" onClick={() => void open(p)}>
                <span className="recent-projects__icon" aria-hidden="true">
                  <FileText size={16} />
                </span>
                <span className="recent-projects__text">
                  <span className="recent-projects__name">
                    {p.name}
                    {p.id === openId ? <Badge variant="neutral">Open</Badge> : null}
                  </span>
                  <span className="recent-projects__meta">
                    {plural(p.constructCount, 'construct')} ·{' '}
                    {plural(p.indicatorCount, 'indicator')} · Edited {formatUpdated(p.updatedAt)}
                  </span>
                </span>
              </button>
              <IconButton
                aria-label={`Delete ${p.name}`}
                size="small"
                tooltipPlacement="top"
                onClick={() => setToDelete(p)}
              >
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState level={4} icon={<FileText />} title="No projects yet">
          <p>
            {state.status === 'error'
              ? 'Saved projects could not be read in this browser (storage may be blocked).'
              : 'Models you create in the Modeler will be listed here, so you can pick up where you left off.'}
          </p>
        </EmptyState>
      )}
      <Dialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title={`Delete “${toDelete?.name ?? ''}”?`}
        description="The model, its layout and its analysis runs are removed from this browser. This cannot be undone, so download a project file first if you may need it."
        width={480}
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      />
      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear all projects and data?"
        description="Every saved project, imported dataset and analysis run is removed from this browser. It cannot be undone. Learning progress is kept."
        width={480}
        footer={
          <>
            <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => void clearAll()}>
              Clear all
            </Button>
          </>
        }
      />
    </Card>
  );
}
