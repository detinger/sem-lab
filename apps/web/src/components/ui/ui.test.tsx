import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  Menu,
  SegmentedControl,
  Tabs,
  ToastProvider,
  useToast,
} from '@/components/ui';

describe('Tabs', () => {
  function setup() {
    render(
      <Tabs
        aria-label="Sections"
        items={[
          { id: 'one', label: 'One', content: <p>Panel one</p> },
          { id: 'two', label: 'Two', content: <p>Panel two</p> },
          { id: 'three', label: 'Three', content: <p>Panel three</p> },
        ]}
      />,
    );
  }

  it('wires roles, aria-selected, aria-controls and aria-labelledby', () => {
    setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    const panel = screen.getByRole('tabpanel');
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]?.id);
    expect(panel).toHaveTextContent('Panel one');
  });

  it('moves with Left/Right/Home/End, wrapping, and focuses the new tab', async () => {
    const user = userEvent.setup();
    setup();
    const [one, two, three] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement, HTMLElement];
    one.focus();
    await user.keyboard('{ArrowRight}');
    expect(two).toHaveFocus();
    expect(two).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel two');
    await user.keyboard('{End}');
    expect(three).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(one).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(three).toHaveFocus();
    await user.keyboard('{Home}');
    expect(one).toHaveFocus();
  });
});

describe('Dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Rename model"
          footer={<Button onClick={() => setOpen(false)}>Done</Button>}
        >
          <Field label="Name">{(p) => <Input {...p} />}</Field>
        </Dialog>
      </>
    );
  }

  it('is a labelled modal that traps focus, closes on Escape and returns focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open it' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Rename model' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const close = screen.getByRole('button', { name: 'Close dialog' });
    const input = screen.getByRole('textbox', { name: 'Name' });
    const done = screen.getByRole('button', { name: 'Done' });
    // First focusable element receives focus; Tab cycles inside the dialog.
    expect(close).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab();
    expect(done).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(done).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('Menu', () => {
  it('opens with the keyboard, navigates with arrows, selects and returns focus', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(
      <Menu
        label="Actions"
        items={[
          { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', onSelect: onUndo },
          { id: 'off', label: 'Disabled', disabled: true, onSelect: () => {} },
          { id: 'redo', label: 'Redo', onSelect: () => {} },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: /Actions/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    expect(items[0]).toHaveTextContent('Ctrl+Z');

    await user.keyboard('{ArrowDown}'); // skips the disabled item
    expect(items[2]).toHaveFocus();
    await user.keyboard('{ArrowDown}'); // wraps
    expect(items[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(items[0]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('Toast', () => {
  function Harness() {
    const { toast } = useToast();
    return (
      <>
        <button type="button" onClick={() => toast({ title: 'Table copied', variant: 'success' })}>
          Copy
        </button>
        <button
          type="button"
          onClick={() => toast({ title: 'Import failed', variant: 'error', duration: 0 })}
        >
          Fail
        </button>
      </>
    );
  }

  it('shows a status toast and announces errors with role=alert', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('status')).toHaveTextContent('Table copied');

    await user.click(screen.getByRole('button', { name: 'Fail' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Import failed');

    await user.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[1]!);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('auto-dismisses after its duration', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('IconButton', () => {
  it('exposes its label as the accessible name', () => {
    render(<IconButton aria-label="Undo">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('refuses to render without a label', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = {} as unknown as { 'aria-label': string };
    expect(() => render(<IconButton {...props}>x</IconButton>)).toThrow(/aria-label/);
  });
});

describe('SegmentedControl', () => {
  it('is a radiogroup that selects with arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Orientation"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Orientation' })).toBeInTheDocument();
    screen.getByRole('radio', { name: 'A' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
