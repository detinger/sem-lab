import type { HTMLAttributes } from 'react';

import { cx } from './cx';
import './Toolbar.css';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  'aria-label': string;
}

export function Toolbar({ className, ...rest }: ToolbarProps) {
  return <div role="toolbar" className={cx('ui-toolbar', className)} {...rest} />;
}

export function ToolbarGroup({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div role="group" className={cx('ui-toolbar__group', className)} {...rest} />;
}

export function ToolbarSeparator() {
  return <div role="separator" aria-orientation="vertical" className="ui-toolbar__sep" />;
}
