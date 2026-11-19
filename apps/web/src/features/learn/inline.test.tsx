import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { useContent } from './content';
import { InlineText } from './inline';
import { parseInline, plainInline } from './inline-parse';

describe('parseInline', () => {
  it('splits bold, italic, code and glossary references', () => {
    expect(parseInline('a **b** c *d* `e` [[ave]] f')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'italic', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'e' },
      { kind: 'text', text: ' ' },
      { kind: 'term', id: 'ave' },
      { kind: 'text', text: ' f' },
    ]);
  });
  it('leaves unmatched markers as text and treats 2*3*4 style math carefully', () => {
    expect(plainInline('a * b and **open')).toBe('a * b and **open');
    expect(plainInline('Σλ² and (1 − λ²) are plain')).toBe('Σλ² and (1 − λ²) are plain');
  });
  it('plainInline drops the markers', () => {
    expect(plainInline('**x** *y* `z` [[average-variance]]')).toBe('x y z average variance');
  });
});

describe('InlineText', () => {
  beforeEach(() => useContent.setState(fixtureContent));

  it('renders markup as elements', () => {
    const { container } = render(
      <MemoryRouter>
        <InlineText text="**bold** *it* `code`" />
      </MemoryRouter>,
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('it');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('never injects HTML: tags and handlers stay text', () => {
    const evil = '<img src=x onerror="alert(1)"> **<script>alert(2)</script>** `<b>x</b>` [[<b>]]';
    const { container } = render(
      <MemoryRouter>
        <InlineText text={evil} />
      </MemoryRouter>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.textContent).toContain('<script>alert(2)</script>');
  });

  it('opens a glossary popover with the definition and a Reference link', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <p>
          <InlineText text="See [[reliability]] and [[no-such-term]]." />
        </p>
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: 'Reliability' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toHaveTextContent(/consistently/);
    expect(screen.getByRole('link', { name: 'Open in Reference' })).toHaveAttribute(
      'href',
      '/reference?term=reliability',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('note')).toBeNull();
    // unknown ids degrade to plain text, not a broken button
    expect(screen.getByText('no such term')).toBeInTheDocument();
  });
});
