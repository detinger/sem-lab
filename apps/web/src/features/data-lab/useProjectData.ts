import { useEffect } from 'react';
import { readLastProjectId } from '@/features/modeler/useAutosave';
import { useModeler } from '@/features/modeler/store';
import { loadProject } from '@/storage/projects';
import { useDataLab } from './store';

/**
 * Opens the last project when none is open (as the Modeler does) and keeps the in-memory
 * dataset in step with the open project's data link: when the project points at a
 * fingerprint, look it up in this browser's stored datasets.
 */
export function useProjectData(): void {
  const fingerprint = useModeler((s) => s.datasetRef?.fingerprint);

  useEffect(() => {
    const id = readLastProjectId();
    if (!id || useModeler.getState().model.constructs.length > 0) return;
    loadProject(id)
      .then((p) => {
        if (p && useModeler.getState().model.constructs.length === 0) useModeler.getState().load(p);
      })
      .catch(() => {
        /* a project that cannot be read simply is not opened; the page stays usable */
      });
  }, []);

  useEffect(() => {
    void useDataLab.getState().restoreFor(useModeler.getState().datasetRef);
  }, [fingerprint]);
}
