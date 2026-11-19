import type { ButtonHTMLAttributes } from 'react';

import { cx } from './cx';
import './Chip.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Filter chip: a toggle button exposing its state through aria-pressed. */
export function Chip({ selected = false, type = 'button', className, ...rest }: ChipProps) {
  return (
    <button type={type} aria-pressed={selected} className={cx('ui-chip', className)} {...rest} />
  );
}
