import type { SemMethod } from '@sem-studio/contracts';
import { useState } from 'react';
import { Callout, Card, CardHeader, SegmentedControl } from '@/components/ui';
import { useModeler } from '@/features/modeler/store';
import { plural } from './format';
import { useReadiness } from './readiness';
import { ValidationList } from './ValidationList';

const METHODS: Array<{ value: SemMethod; label: string }> = [
  { value: 'pls-sem', label: 'PLS-SEM' },
  { value: 'plsc', label: 'PLSc' },
  { value: 'cb-sem', label: 'CB-SEM' },
];

export function summaryLine(c: {
  error: number;
  warning: number;
  recommendation: number;
  info: number;
}): string {
  return `${plural(c.error, 'error')} · ${plural(c.warning, 'warning')} · ${plural(c.recommendation, 'recommendation')} · ${plural(c.info, 'info note')}`;
}

export function ReadinessSection() {
  const [method, setMethod] = useState<SemMethod>('pls-sem');
  const { issues, blocked, counts, hasData } = useReadiness(method);
  const empty = useModeler(
    (s) => s.model.constructs.length === 0 && s.model.indicators.length === 0,
  );

  function focusElements(ids: string[]): void {
    useModeler.getState().select(ids);
    const row = document.getElementById(`map-ind-${ids[0]}`);
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.querySelector<HTMLElement>('select, input')?.focus();
    } else {
      document.getElementById('dl-mapping')?.scrollIntoView({ block: 'start' });
    }
  }

  return (
    <Card className="dl-card" aria-labelledby="dl-ready-h">
      <CardHeader
        level={2}
        title={<span id="dl-ready-h">Readiness</span>}
        action={
          <SegmentedControl
            aria-label="Method the checks apply to"
            size="small"
            value={method}
            onChange={setMethod}
            options={METHODS}
          />
        }
      />
      <p className="dl-muted">
        The method only selects which rules apply; no analysis runs in this version of SEM Studio.
      </p>
      {empty ? (
        <p className="dl-muted">There is no model to check yet. Build one in the Modeler.</p>
      ) : (
        <>
          <p className="dl-summary" role="status">
            <strong>{summaryLine(counts)}</strong>
            {blocked
              ? ' — analysis is blocked while errors remain.'
              : ' — no errors block the analysis.'}
          </p>
          {!hasData ? (
            <Callout variant="info">
              No data are loaded, so the data checks (mapping, scales, missing values, sample size)
              are skipped.
            </Callout>
          ) : null}
          <ValidationList issues={issues} onFocus={focusElements} focusLabel="Show in mapping" />
        </>
      )}
    </Card>
  );
}
