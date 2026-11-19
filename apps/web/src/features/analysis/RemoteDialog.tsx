import { Button, Dialog } from '@/components/ui';

export function hostOf(base: string | null): string {
  if (!base) return 'the analysis service';
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

export interface RemoteDialogProps {
  open: boolean;
  host: string;
  nRows: number;
  nColumns: number;
  retentionHours: number | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Shown before the first remote run of a session (PLAN §2.2, STYLE §12). */
export function RemoteDialog({
  open,
  host,
  nRows,
  nColumns,
  retentionHours,
  onCancel,
  onConfirm,
}: RemoteDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Data leaves your browser for this analysis"
      description="SEM Studio keeps your data in this browser. Running the analysis sends a copy to a server that runs R."
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm}>
            Send data and run
          </Button>
        </>
      }
    >
      <dl className="an-dl">
        <dt>What is sent</dt>
        <dd>
          Only the {nRows.toLocaleString('en')} × {nColumns} matrix of the indicator columns mapped
          in your model, and the model structure. Not the file, and no other columns.
        </dd>
        <dt>Where</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>How long it is kept</dt>
        <dd>
          {retentionHours !== null
            ? `Up to ${retentionHours} hours, then it is deleted automatically.`
            : 'The service deletes it automatically after its retention period.'}{' '}
          “Delete uploaded data” on the Analysis page removes it immediately.
        </dd>
      </dl>
      <p className="an-note">You will only be asked once in this session.</p>
    </Dialog>
  );
}
