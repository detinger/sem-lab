import type {
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

import { cx } from './cx';
import './Table.css';

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Accessible name for the scroll region (it is keyboard-focusable so it can scroll). */
  'aria-label': string;
  wrapperClassName?: string;
}

/** Bordered, horizontally scrollable table wrapper with sticky 12px header (STYLE.md section 13). */
export function Table({
  'aria-label': ariaLabel,
  wrapperClassName,
  className,
  ...rest
}: TableProps) {
  return (
    // A scrollable region must be keyboard-focusable so it can be scrolled without a pointer.
    <div
      className={cx('ui-table-wrap', wrapperClassName)}
      role="region"
      aria-label={ariaLabel}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    >
      <table className={cx('ui-table', className)} {...rest} />
    </div>
  );
}

export function Th({
  numeric,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th className={cx(numeric && 'ui-table__num', className)} {...rest} />;
}

export function Td({
  numeric,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cx(numeric && 'ui-table__num', className)} {...rest} />;
}

export function TableCaption(props: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className="ui-table__caption" {...props} />;
}
