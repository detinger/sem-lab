import { Crosshair } from 'lucide-react';
import { Button, ValidationRow } from '@/components/ui';
import type { ValidationIssue } from '@/domain/validation/validate';
import './data-lab.css';

export interface ValidationListProps {
  issues: readonly ValidationIssue[];
  /** called with the model element ids of the issue; the action is hidden without it */
  onFocus?: (elementIds: string[], issue: ValidationIssue) => void;
  focusLabel?: string;
  /** text of the single "all clear" row */
  emptyTitle?: string;
}

/** Validator issues as expandable rows: severity stripe + icon + text, never colour alone. */
export function ValidationList({
  issues,
  onFocus,
  focusLabel = 'Focus element',
  emptyTitle = 'No issues found',
}: ValidationListProps) {
  if (issues.length === 0) {
    return (
      <div className="dl-vlist">
        <ValidationRow severity="success" title={emptyTitle} />
      </div>
    );
  }
  return (
    <ul className="dl-vlist" aria-label="Validation results">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`}>
          <ValidationRow
            severity={issue.severity}
            title={issue.title}
            defaultOpen={issue.severity === 'error'}
          >
            <p className="dl-vrow-text">{issue.explanation}</p>
            {issue.fixes.length > 0 ? (
              <>
                <p className="dl-vrow-label">How to fix</p>
                <ul className="dl-vrow-fixes">
                  {issue.fixes.map((fix) => (
                    <li key={fix}>{fix}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {issue.columns && issue.columns.length > 0 ? (
              <p className="dl-vrow-meta">Columns: {issue.columns.join(', ')}</p>
            ) : null}
            {onFocus && issue.elementIds.length > 0 ? (
              <Button
                size="small"
                icon={<Crosshair size={14} />}
                onClick={() => onFocus(issue.elementIds, issue)}
              >
                {focusLabel}
              </Button>
            ) : null}
          </ValidationRow>
        </li>
      ))}
    </ul>
  );
}
