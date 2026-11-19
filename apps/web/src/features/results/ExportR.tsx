import { FileCode2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Tooltip, useToast } from '@/components/ui';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import type { Dataset } from '@/domain/dataset/types';
import type { RunView } from '@/features/analysis/runs';
import {
  type ExportLanguage,
  LAVAAN_TESTED,
  buildExportBundle,
  exportBlock,
} from '@/features/code-export';
import { useDataLab } from '@/features/data-lab/store';
import { listDatasets, loadDataset } from '@/storage/datasets';

export const APP_VERSION = '0.0.0';

export function download(filename: string, content: string | Uint8Array, type: string): void {
  const url = URL.createObjectURL(
    new Blob([typeof content === 'string' ? content : (content as Uint8Array<ArrayBuffer>)], {
      type,
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The dataset the run was computed from: the active one when it matches, else the stored copy. */
async function datasetOf(run: RunView): Promise<Dataset | null> {
  const active = useDataLab.getState().dataset;
  if (active?.fingerprint === run.dataFingerprint) return active;
  try {
    const hit = (await listDatasets()).find((d) => d.fingerprint === run.dataFingerprint);
    return hit ? ((await loadDataset(hit.id)) ?? null) : null;
  } catch {
    return null;
  }
}

/** Why the R (lavaan) export is unavailable for this run, or null when it is offered. */
export function cbExportBlock(run: RunView): string | null {
  return exportBlock('r', run.record.options, run.model);
}

/** The verified single-file Python engine, loaded only when a Python export is requested. */
async function pythonEngineSource(): Promise<string> {
  return (await import('../../../../../packages/python-engine/dist/semlab_bundle.py?raw')).default;
}

function ExportButton({
  run,
  projectName,
  language,
}: {
  run: RunView;
  projectName: string;
  language: ExportLanguage;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const result = run.record.result;
  const block = exportBlock(language, run.record.options, run.model);
  const label = language === 'r' ? 'Export R script' : 'Export Python script';

  const onClick = async (): Promise<void> => {
    if (!result || block) return;
    setBusy(true);
    try {
      const ds = await datasetOf(run);
      const data = ds
        ? buildAnalysisData(
            run.model,
            ds,
            run.record.options.missingData === 'fiml' ? 'fiml' : 'listwise',
          )
        : null;
      if (!ds || !data || 'error' in data) {
        toast({
          title: 'The data of this run are not available in this browser',
          description: 'Import the same data again, then export.',
          variant: 'error',
        });
        return;
      }
      const bundle = await buildExportBundle({
        language,
        projectName,
        model: run.model,
        analysis: run.record.options,
        result,
        modelHash: run.modelHash,
        dataFingerprint: run.dataFingerprint,
        runId: run.runId,
        runCreatedAt: run.createdAt,
        data,
        transformations: ds.transformations,
        generatedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        ...(language === 'python' ? { pythonEngineSource: await pythonEngineSource() } : {}),
      });
      download(bundle.fileName, bundle.bytes, 'application/zip');
      toast({
        title: `${language === 'r' ? 'R' : 'Python'} export downloaded`,
        description: 'Unzip it and follow README.md. The folder contains your data.',
        variant: 'success',
      });
    } catch (e) {
      toast({
        title: 'The export could not be written',
        ...(e instanceof Error ? { description: e.message } : {}),
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const button = (
    <Button
      icon={<FileCode2 size={16} />}
      disabled={Boolean(block) || !result || busy}
      onClick={() => void onClick()}
    >
      {label}
    </Button>
  );
  return (
    <>
      {block ? <Tooltip content={block}>{button}</Tooltip> : button}
      {block ? <p className="rs-note">{block}</p> : null}
    </>
  );
}

export function ExportRButton({ run, projectName }: { run: RunView; projectName: string }) {
  const isCb = run.record.method === 'cb-sem';
  return (
    <div className="rs-export">
      <div className="rs-export-buttons">
        <ExportButton run={run} projectName={projectName} language="r" />
        <ExportButton run={run} projectName={projectName} language="python" />
      </div>
      {run.staleness !== 'current' ? (
        <p className="rs-note">Exports the model and data of this historical run.</p>
      ) : null}
      <p className="rs-note">
        Each export is a ZIP with the script, the exact data analysed, the model, this result and a
        reproducibility manifest (versions, settings and checksums).{' '}
        {isCb
          ? `The R script reproduces these numbers with R ${LAVAAN_TESTED.R} and lavaan ${LAVAAN_TESTED.lavaan} to about 1e-6.`
          : 'The R script reproduces these numbers exactly with R 4.6.2 and cSEM 0.7.1.'}{' '}
        The Python script runs SEM Lab’s own engine and checks every number against this result.
        Both are verified by automated tests.
      </p>
    </div>
  );
}
