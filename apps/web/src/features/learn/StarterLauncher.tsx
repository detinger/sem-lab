import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, useToast } from '@/components/ui';
import { openStarter, projectHasContent } from '@/features/examples/openExample';
import type { Starter } from './schema';

/**
 * Opens a starter as a new project, asking first when the current project has content (the
 * current one stays saved in this browser either way). `after` runs once the new project is
 * open, e.g. to mark a challenge as active.
 */
export function useStarterLauncher(after?: () => void): {
  request: (starter: Starter) => void;
  busy: boolean;
  dialog: ReactNode;
} {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [pending, setPending] = useState<Starter | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(starter: Starter) {
    setPending(null);
    setBusy(true);
    try {
      const to = await openStarter(starter);
      after?.();
      toast({
        variant: 'success',
        title: 'Started',
        description: `${starter.title} is open as a new project.`,
      });
      void navigate(to);
    } catch (e) {
      toast({
        variant: 'error',
        title: 'The starter could not be opened',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <Dialog
      open={pending !== null}
      onClose={() => setPending(null)}
      title="Open this as a new project?"
      description="Your current model stays saved in this browser. The starter opens as a new project."
      footer={
        <>
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => pending && void run(pending)}>
            Open starter
          </Button>
        </>
      }
    >
      {pending ? <p>New project: {pending.title}</p> : null}
    </Dialog>
  );

  return {
    request: (starter) => (projectHasContent() ? setPending(starter) : void run(starter)),
    busy,
    dialog,
  };
}
