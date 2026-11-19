import type { HTMLAttributes } from 'react';

import { cx } from './cx';
import './Kbd.css';

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cx('ui-kbd', className)} {...rest} />;
}
