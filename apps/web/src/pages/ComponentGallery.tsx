import { Download, FileText, Play, Plus, Settings, Trash2, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  KpiGrid,
  KpiTile,
  LinkCard,
  Menu,
  PageHeader,
  ProgressBar,
  SegmentedControl,
  Select,
  Spinner,
  Switch,
  Table,
  TableCaption,
  Tabs,
  Td,
  Textarea,
  Th,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  Tooltip,
  useToast,
  ValidationRow,
  type BadgeVariant,
  type ButtonVariant,
  type CalloutVariant,
  type Severity,
  type ToastVariant,
} from '@/components/ui';

import './gallery.css';

const BUTTON_VARIANTS: ButtonVariant[] = [
  'default',
  'primary',
  'secondary',
  'ghost',
  'danger',
  'selected',
  'accent',
];
const BADGE_VARIANTS: BadgeVariant[] = [
  'neutral',
  'info',
  'success',
  'warning',
  'error',
  'recommendation',
  'accent',
];
const CALLOUT_VARIANTS: CalloutVariant[] = [
  'info',
  'recommendation',
  'warning',
  'error',
  'success',
];
const SEVERITIES: Severity[] = ['error', 'warning', 'recommendation', 'info', 'success'];
const TOAST_VARIANTS: ToastVariant[] = ['default', 'info', 'success', 'warning', 'error'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery__section" aria-labelledby={`g-${title}`}>
      <h2 id={`g-${title}`}>{title}</h2>
      <div className="gallery__stack">{children}</div>
    </section>
  );
}

export function ComponentGallery() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [chips, setChips] = useState({ pls: true, cb: false, all: false });
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);

  return (
    <>
      <PageHeader
        eyebrow="Development"
        title="Component gallery"
        description="Every shared UI primitive in every variant, for visual review in both themes. Values shown are placeholders, never results."
        actions={<Badge variant="warning">Not part of the product navigation</Badge>}
      />

      <Section title="Buttons">
        <div className="gallery__row">
          {BUTTON_VARIANTS.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </div>
        <div className="gallery__row">
          {BUTTON_VARIANTS.map((v) => (
            <Button key={v} variant={v} size="small">
              {v}
            </Button>
          ))}
        </div>
        <div className="gallery__row">
          <Button variant="primary" icon={<Play />}>
            Run analysis
          </Button>
          <Button icon={<Download />}>Export code</Button>
          <Button variant="danger" icon={<Trash2 />}>
            Delete
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="gallery__row">
          <IconButton aria-label="Settings" variant="default">
            <Settings size={16} />
          </IconButton>
          <IconButton aria-label="Undo">
            <Undo2 size={16} />
          </IconButton>
          <IconButton aria-label="Add" size="small" variant="default">
            <Plus size={14} />
          </IconButton>
          <IconButton aria-label="Add selected" variant="selected">
            <Plus size={16} />
          </IconButton>
          <IconButton aria-label="Remove" variant="danger" disabled>
            <Trash2 size={16} />
          </IconButton>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="gallery__grid">
          <Field label="Project name" hint="Shown in the project list.">
            {(p) => <Input placeholder="Technology acceptance" {...p} />}
          </Field>
          <Field label="Small input" hint="28px control height.">
            {(p) => <Input size="small" placeholder="Small" {...p} />}
          </Field>
          <Field label="Indicator code" error="Use letters, digits and underscores only." required>
            {(p) => <Input defaultValue="PU 1" {...p} />}
          </Field>
          <Field label="Estimator">
            {(p) => (
              <Select defaultValue="pls" {...p}>
                <option value="pls">PLS-SEM</option>
                <option value="cb">CB-SEM</option>
              </Select>
            )}
          </Field>
          <Field label="Small select">
            {(p) => (
              <Select size="small" defaultValue="pls" {...p}>
                <option value="pls">PLS-SEM</option>
                <option value="cb">CB-SEM</option>
              </Select>
            )}
          </Field>
          <Field label="Disabled input">
            {(p) => <Input disabled placeholder="Disabled" {...p} />}
          </Field>
          <Field label="Notes" hint="Auto height, vertical resize.">
            {(p) => <Textarea placeholder="Describe the model" {...p} />}
          </Field>
        </div>
        <div className="gallery__row">
          <Checkbox
            label="Show loadings"
            hint="Label measurement paths."
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <Checkbox label="Unchecked" />
          <Checkbox label="Disabled" disabled />
          <Switch label="Snap to grid" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <Switch label="Off" />
          <Switch label="Disabled" disabled />
        </div>
        <div className="gallery__row">
          <SegmentedControl
            aria-label="Orientation"
            value={orientation}
            onChange={setOrientation}
            options={[
              { value: 'horizontal', label: 'Left to right' },
              { value: 'vertical', label: 'Top to bottom' },
            ]}
          />
          <SegmentedControl
            aria-label="Orientation (small)"
            size="small"
            value={orientation}
            onChange={setOrientation}
            options={[
              { value: 'horizontal', label: 'Left to right' },
              { value: 'vertical', label: 'Top to bottom' },
            ]}
          />
        </div>
      </Section>

      <Section title="Badges and chips">
        <div className="gallery__row">
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </div>
        <div className="gallery__row">
          <Chip selected={chips.pls} onClick={() => setChips((c) => ({ ...c, pls: !c.pls }))}>
            PLS-SEM
          </Chip>
          <Chip selected={chips.cb} onClick={() => setChips((c) => ({ ...c, cb: !c.cb }))}>
            CB-SEM
          </Chip>
          <Chip selected={chips.all} onClick={() => setChips((c) => ({ ...c, all: !c.all }))}>
            Beginner
          </Chip>
          <Chip disabled>Disabled</Chip>
        </div>
      </Section>

      <Section title="Cards">
        <div className="gallery__grid">
          <Card>
            <CardHeader
              title="Standard card"
              action={
                <IconButton aria-label="Card settings" size="small">
                  <Settings size={14} />
                </IconButton>
              }
            />
            <p className="text-muted">
              Elevated surface, 1px border, 10px radius, smallest shadow.
            </p>
          </Card>
          <LinkCard to="/">
            <CardHeader title="Linked card" icon={<FileText size={16} />} />
            <p className="text-muted">Hover for the primary border and medium shadow.</p>
          </LinkCard>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          aria-label="Gallery tabs"
          items={[
            { id: 'a', label: 'Measurement', content: <p>Measurement panel content.</p> },
            { id: 'b', label: 'Structural', content: <p>Structural panel content.</p> },
            { id: 'c', label: 'Fit', content: <p>Fit panel content.</p> },
          ]}
        />
        <Tabs
          dense
          aria-label="Dense gallery tabs"
          items={[
            { id: 'a', label: 'Inspector', content: <p>Dense tab panel.</p> },
            { id: 'b', label: 'Data', content: <p>Second dense panel.</p> },
          ]}
        />
      </Section>

      <Section title="Callouts">
        {CALLOUT_VARIANTS.map((v) => (
          <Callout key={v} variant={v} title={`${v} callout`}>
            Explanatory text sits next to the task it relates to.
          </Callout>
        ))}
      </Section>

      <Section title="Validation rows">
        {SEVERITIES.map((s) => (
          <ValidationRow
            key={s}
            severity={s}
            title={`${s} validation row`}
            defaultOpen={s === 'error'}
          >
            The explanation connects the problem to its consequence and a possible fix.
          </ValidationRow>
        ))}
        <ValidationRow severity="info" title="A row without an explanation" />
      </Section>

      <Section title="Empty state, spinner, progress">
        <Card>
          <EmptyState
            icon={<FileText />}
            level={3}
            title="Nothing here yet"
            action={<Button variant="primary">Create model</Button>}
          >
            <p>Next steps and context appear below the heading.</p>
          </EmptyState>
        </Card>
        <div className="gallery__row">
          <Spinner label="Loading" />
          <Spinner label="Loading large" size={28} />
          <span className="text-muted">
            Indeterminate activity uses a spinner, never a fake bar.
          </span>
        </div>
        <div className="gallery__grid">
          <ProgressBar label="Rows parsed (determinate)" value={40} />
          <ProgressBar label="Empty track" value={0} />
          <ProgressBar label="Complete" value={100} />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="gallery__row">
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Menu
            label="Actions"
            items={[
              {
                id: 'undo',
                label: 'Undo',
                icon: <Undo2 />,
                shortcut: 'Ctrl+Z',
                onSelect: () => {},
              },
              { id: 'dl', label: 'Export code', icon: <Download />, onSelect: () => {} },
              { id: 'off', label: 'Unavailable', disabled: true, onSelect: () => {} },
              {
                id: 'del',
                label: 'Delete model',
                icon: <Trash2 />,
                danger: true,
                onSelect: () => {},
              },
            ]}
          />
          <Tooltip content="A tooltip describes the control">
            <Button>Hover or focus me</Button>
          </Tooltip>
        </div>
        <div className="gallery__row">
          {TOAST_VARIANTS.map((v) => (
            <Button
              key={v}
              size="small"
              onClick={() =>
                toast({
                  variant: v,
                  title: `${v} toast`,
                  description: 'Pauses auto-dismiss while hovered.',
                })
              }
            >
              Toast: {v}
            </Button>
          ))}
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Example dialog"
          description="Focus is trapped here; Escape closes it and focus returns to the trigger."
          footer={
            <>
              <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>
                Save changes
              </Button>
            </>
          }
        >
          <Field label="Model name">{(p) => <Input {...p} />}</Field>
        </Dialog>
      </Section>

      <Section title="Toolbar, keys">
        <Toolbar aria-label="Example toolbar">
          <ToolbarGroup aria-label="History">
            <IconButton aria-label="Undo (toolbar)" size="small">
              <Undo2 size={14} />
            </IconButton>
            <IconButton aria-label="Add (toolbar)" size="small">
              <Plus size={14} />
            </IconButton>
          </ToolbarGroup>
          <ToolbarSeparator />
          <ToolbarGroup aria-label="Run">
            <Button size="small" variant="primary" icon={<Play />}>
              Run analysis
            </Button>
          </ToolbarGroup>
        </Toolbar>
        <p>
          Keyboard shortcuts such as <Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd> use monospace.
        </p>
      </Section>

      <Section title="KPI tiles">
        <KpiGrid>
          <KpiTile label="Constructs" value="—" detail="Not computed" />
          <KpiTile label="Indicators" value="—" detail="Not computed" />
          <KpiTile label="Sample size" value="—" detail="No data imported" />
        </KpiGrid>
      </Section>

      <Section title="Table">
        <Table aria-label="Example table">
          <TableCaption>Placeholder cells only. Numeric columns align right.</TableCaption>
          <thead>
            <tr>
              <Th>Indicator</Th>
              <Th>Construct</Th>
              <Th numeric>Loading</Th>
              <Th numeric>Weight</Th>
            </tr>
          </thead>
          <tbody>
            {['First', 'Second', 'Third'].map((name) => (
              <tr key={name}>
                <Td>{name} indicator</Td>
                <Td>Example construct</Td>
                <Td numeric>—</Td>
                <Td numeric>—</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  );
}
