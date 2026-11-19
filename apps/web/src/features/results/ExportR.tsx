import { FileCode2 } from 'lucide-react';
import { Button, Tooltip, useToast } from '@/components/ui';
import { buildAnalysisData } from '@/domain/dataset/analysis-data';
import type { Dataset } from '@/domain/dataset/types';
import type { RunView } from '@/features/analysis/runs';
import {
  LAVAAN_TESTED,
  analysisCsv,
  exportCsemScript,
  exportLavaanScript,
} from '@/features/code-export';
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

/** Why the CB export is unavailable for this run, or null when it is offered. */
export function cbExportBlock(run: RunView): string | null {
  if (run.record.method !== 'cb-sem') return null;
  const e = run.record.options.estimator;
  if (e !== 'ML' && e !== 'MLR')
    return `The lavaan export covers ML and MLR only; this run used ${e}.`;
  if (run.model.constructs.some((c) => c.measurement !== 'reflective'))
    return 'The lavaan export needs reflective constructs only; this model has composite constructs.';
  return null;
}

export function ExportRButton({ run, projectName }: { run: RunView; projectName: string }) {
  const { toast } = useToast();
  const isCb = run.record.method === 'cb-sem';
  const result = run.record.result;
  const block = cbExportBlock(run);

  const onClick = async (): Promise<void> => {
    if (!result || block) return;
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
    const common = {
      model: run.model,
      analysis: run.record.options,
      projectName,
      modelHash: run.modelHash,
      dataFingerprint: run.dataFingerprint,
      nRows: result.sample.nRows,
      nUsed: result.sample.nUsed,
      transformations: ds.transformations,
      generatedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
    };
    let script: string;
    try {
      script = isCb
        ? exportLavaanScript(common)
        : exportCsemScript({
            ...common,
            dataColumns: data.columns,
            ...(result.bootstrap ? { chunkSize: result.bootstrap.chunkSize } : {}),
          });
    } catch (e) {
      toast({
        title: 'The R script could not be written',
        ...(e instanceof Error ? { description: e.message } : {}),
        variant: 'error',
      });
      return;
    }
    download(
      `${safe(projectName)}-${isCb ? 'lavaan' : 'cSEM'}.R`,
      script,
      'text/plain;charset=utf-8',
    );
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
      disabled={Boolean(block) || !result}
      onClick={() => void onClick()}
    >
      Export R script
    </Button>
  );
  return (
    <div className="rs-export">
      {block ? <Tooltip content={block}>{button}</Tooltip> : button}
      {block ? <p className="rs-note">{block}</p> : null}
      {run.staleness !== 'current' ? (
        <p className="rs-note">Exports the model and data of this historical run.</p>
      ) : null}
      <p className="rs-note">
        {isCb
          ? `The script and data file reproduce these estimates, standard errors and fit indices with R ${LAVAAN_TESTED.R} and lavaan ${LAVAAN_TESTED.lavaan} (verified by an automated test; the last digits, about 1e-6, can differ).`
          : 'The script and data file reproduce these estimates and bootstrap intervals exactly with R 4.6.2 and cSEM 0.7.1 (verified by an automated test).'}
      </p>
    </div>
  );
}
