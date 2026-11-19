import { FileCode2 } from 'lucide-react';
import { Button, Tooltip, useToast } from '@/components/ui';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import type { Dataset } from '@/domain/dataset/types';
import { analysisCsv } from '@/features/analysis/api';
import type { RunView } from '@/features/analysis/runs';
import { exportCsemScript } from '@/features/code-export';
import { useDataLab } from '@/features/data-lab/store';
import { listDatasets, loadDataset } from '@/storage/datasets';

export const APP_VERSION = '0.0.0';

export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safe = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'sem-model';

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

export function ExportRButton({ run, projectName }: { run: RunView; projectName: string }) {
  const { toast } = useToast();
  const isCb = run.record.method === 'cb-sem';
  const result = run.record.result;

  const onClick = async (): Promise<void> => {
    if (!result) return;
    const ds = await datasetOf(run);
    const data = ds ? buildAnalysisData(run.model, ds, 'listwise') : null;
    if (!ds || !data || 'error' in data) {
      toast({
        title: 'The data of this run are not available in this browser',
        description: 'Import the same data again, then export.',
        variant: 'error',
      });
      return;
    }
    const script = exportCsemScript({
      model: run.model,
      analysis: run.record.options,
      projectName,
      modelHash: run.modelHash,
      dataFingerprint: run.dataFingerprint,
      dataColumns: data.columns,
      nRows: result.sample.nRows,
      nUsed: result.sample.nUsed,
      transformations: ds.transformations,
      generatedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      ...(result.bootstrap ? { chunkSize: result.bootstrap.chunkSize } : {}),
    });
    download(`${safe(projectName)}-cSEM.R`, script, 'text/plain;charset=utf-8');
    download('analysis-data.csv', analysisCsv(data), 'text/csv;charset=utf-8');
    toast({
      title: 'R script and data file downloaded',
      description: 'Keep both files in the same folder.',
      variant: 'success',
    });
  };

  const button = (
    <Button
      icon={<FileCode2 size={16} />}
      disabled={isCb || !result}
      onClick={() => void onClick()}
    >
      Export R script
    </Button>
  );
  return (
    <div className="rs-export">
      {isCb ? (
        <Tooltip content="CB-SEM export arrives with the lavaan adapter">{button}</Tooltip>
      ) : (
        button
      )}
      {isCb ? <p className="rs-note">CB-SEM export arrives with the lavaan adapter</p> : null}
      {run.staleness !== 'current' ? (
        <p className="rs-note">Exports the model and data of this historical run.</p>
      ) : null}
      <p className="rs-note">
        The script and data file reproduce these estimates and bootstrap intervals exactly with R
        4.6.2 and cSEM 0.7.1 (verified by an automated test).
      </p>
    </div>
  );
}
