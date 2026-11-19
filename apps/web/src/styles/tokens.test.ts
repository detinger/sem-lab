// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** The first ```css fence after the section 16 heading holds the light and dark token blocks. */
function styleSection16Tokens(): string {
  const style = read('../../../../STYLE.md');
  const section = style.slice(style.indexOf('## 16. Implementation CSS tokens'));
  const match = /```css\n([\s\S]*?)```/.exec(section);
  if (!match?.[1]) {
    throw new Error('STYLE.md section 16 no longer contains a css block');
  }
  return match[1];
}

/** tokens.css without its leading header comment. */
function tokensCssBody(): string {
  const css = read('./tokens.css');
  const end = css.indexOf('*/');
  if (!css.startsWith('/*') || end === -1) {
    throw new Error('tokens.css must start with its header comment');
  }
  return css.slice(end + 2).replace(/^\n/, '');
}

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    if (match[1] && match[2]) {
      map.set(match[1], match[2].trim());
    }
  }
  return map;
}

describe('theme tokens', () => {
  it('are a verbatim copy of STYLE.md section 16', () => {
    expect(tokensCssBody()).toBe(styleSection16Tokens());
  });

  it('define every color role in both themes', () => {
    const body = tokensCssBody();
    const darkStart = body.indexOf('[data-theme="dark"]');
    expect(darkStart).toBeGreaterThan(0);
    const light = declarations(body.slice(0, darkStart));
    const dark = declarations(body.slice(darkStart));

    // Fonts and radii are theme-independent and are declared once, in the light block.
    const themeIndependent = (name: string) =>
      name.startsWith('--font-') || name.startsWith('--radius');
    const lightThemed = [...light.keys()].filter((name) => !themeIndependent(name));

    expect(light.size).toBe(54);
    expect(dark.size).toBe(49);
    expect([...dark.keys()]).toEqual(lightThemed);
    expect(light.get('--primary')).toBe('#1f5f8b');
    expect(dark.get('--primary')).toBe('#5aa7d8');
    expect(light.get('--sem-guide')).toBe('#2a78d6');
    expect(dark.get('--canvas-bg')).toBe('#141a22');
  });
});
