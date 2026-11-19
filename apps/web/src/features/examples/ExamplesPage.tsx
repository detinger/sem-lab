import { FolderOpen, NotebookText } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge, Button, Card, CardHeader, Dialog, PageHeader, useToast } from '@/components/ui';
import { CC_BY_4_URL, bundledDatasetInfo } from '@/domain/dataset/bundled';
import { EXAMPLES, type Example } from './examples';
import { openExample, projectHasContent } from './openExample';
import './examples.css';

const METHOD_LABEL = { 'pls-sem': 'PLS-SEM', plsc: 'PLSc', 'cb-sem': 'CB-SEM' } as const;

function ExampleCard({
  example,
  busy,
  onOpen,
}: {
  example: Example;
  busy: boolean;
  onOpen: () => void;
}) {
  const { analysis, dataset, model } = example;
  const info = bundledDatasetInfo(dataset.bundledId);
  const boot = analysis.bootstrap?.enabled ? analysis.bootstrap.repetitions : null;
  const nf = new Intl.NumberFormat('en-US');
  return (
    <Card className="ex-card" aria-label={example.title} role="group">
      <CardHeader title={example.title} />
      <div className="ex-badges">
        <Badge variant="info">{METHOD_LABEL[analysis.method]}</Badge>
        {analysis.ipma ? <Badge variant="neutral">IPMA</Badge> : null}
        {boot !== null ? <Badge variant="neutral">Bootstrap B = {nf.format(boot)}</Badge> : null}
        {dataset.synthetic ? (
          <Badge variant="accent">Synthetic</Badge>
        ) : (
          <Badge variant="success">Real data · {dataset.licence ?? 'licensed'}</Badge>
        )}
      </div>
      <p className="ex-summary">{example.summary}</p>
      <p className="ex-size">
        {model.constructs.length} constructs · {model.indicators.length} indicators
        {info ? ` · ${nf.format(info.rows)} rows` : ''}
      </p>
      <p className="ex-small">Theory: {example.theory}</p>
      {dataset.attribution ? (
        <p className="ex-small">
          {dataset.attribution}{' '}
          {dataset.licence ? (
            <a href={CC_BY_4_URL} target="_blank" rel="noreferrer">
              {dataset.licence} licence
            </a>
          ) : null}
        </p>
      ) : null}
      <div className="ex-actions">
        <Button
          variant="primary"
          icon={<FolderOpen size={16} />}
          disabled={busy}
          aria-label={`Open example: ${example.title}`}
          onClick={onOpen}
        >
          Open example
        </Button>
      </div>
    </Card>
  );
}

export function ExamplesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [pending, setPending] = useState<Example | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(example: Example) {
    setPending(null);
    setBusy(true);
    try {
      await openExample(example);
      toast({
        variant: 'success',
        title: 'Example opened',
        description: `${example.title} is a new project with its data and analysis settings.`,
      });
      void navigate('/modeler');
    } catch (e) {
      toast({
        variant: 'error',
        title: 'The example could not be opened',
        description: e instanceof Error ? e.message : 'Unknown error.',
      });
    } finally {
      setBusy(false);
    }
  }

  function request(example: Example) {
    if (projectHasContent()) setPending(example);
    else void run(example);
  }

  return (
    <>
      <PageHeader
        eyebrow="Learn"
        title="Examples & Colab"
        description="Complete, ready-to-run projects: the model, the data and the analysis settings, opened in one click. Everything runs in this browser."
      />

      <section aria-labelledby="ex-gallery" className="ex-section">
        <h2 id="ex-gallery">Example projects</h2>
        <div className="ex-grid">
          {EXAMPLES.map((ex) => (
            <ExampleCard key={ex.id} example={ex} busy={busy} onOpen={() => request(ex)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="ex-colab" className="ex-section">
        <h2 id="ex-colab">Python notebooks (Google Colab)</h2>
        <Card>
          <CardHeader title="Notebooks arrive in Phase 6" icon={<NotebookText size={18} />} />
          <p className="ex-summary">
            {' '}
            The five Python notebooks that reproduce these analyses are planned for Phase 6. There
            are no notebook links yet.
          </p>
        </Card>
      </section>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Open this example?"
        description="Your current model stays saved in this browser. The example opens as a new project, with its own data and analysis settings."
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => pending && void run(pending)}>
              Open example
            </Button>
          </>
        }
      >
        {pending ? <p className="ex-small">New project: {pending.title}</p> : null}
      </Dialog>
    </>
  );
}
