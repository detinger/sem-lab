/**
 * Index reached from `index` by a roving-focus key, or null when the key does not navigate.
 * ArrowRight/ArrowLeft always navigate; `vertical` adds ArrowDown/ArrowUp. Navigation wraps.
 */
export function rovingTarget(
  key: string,
  index: number,
  length: number,
  vertical = false,
): number | null {
  if (length === 0) return null;
  if (key === 'ArrowRight' || (vertical && key === 'ArrowDown')) return (index + 1) % length;
  if (key === 'ArrowLeft' || (vertical && key === 'ArrowUp')) return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}
