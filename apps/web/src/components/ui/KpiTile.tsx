import type { ReactNode } from 'react';

import { cx } from './cx';
import './KpiTile.css';

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}

export function KpiTile({ label, value, detail, className }: KpiTileProps) {
  return (
    <div className={cx('ui-kpi', className)}>
      <div className="ui-kpi__label">{label}</div>
      <div className="ui-kpi__value">{value}</div>
      {detail ? <div className="ui-kpi__detail">{detail}</div> : null}
    </div>
  );
}

/** KPI grid: minimum 170px columns, 12px gaps. */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-kpi-grid', className)}>{children}</div>;
}
