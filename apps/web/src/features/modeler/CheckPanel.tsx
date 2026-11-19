import { useReactFlow } from '@xyflow/react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import type { Readiness } from '@/features/data-lab/readiness';
import { ValidationList } from '@/features/data-lab/ValidationList';
import { plural } from '@/features/data-lab/format';
import { useModeler } from './store';

export const CHECK_PANEL_ID = 'modeler-check-panel';

/** Collapsible "Check model" panel: validator issues with a Focus action that fits the view. */
export function CheckPanel({ readiness, onClose }: { readiness: Readiness; onClose: () => void }) {
  const rf = useReactFlow();
  const { issues, counts, hasData } = readiness;

  function focus(ids: string[]): void {
    const st = useModeler.getState();
    st.select(ids);
    const nodes = ids.filter((id) => st.layout.nodes[id]).map((id) => ({ id }));
    if (nodes.length > 0) void rf.fitView({ nodes, padding: 0.5, maxZoom: 1.2, duration: 250 });
  }

  return (
    <section id={CHECK_PANEL_ID} className="modeler-check" aria-label="Check model">
      <div className="modeler-check__head">
        <h2 className="modeler-check__title">Check model</h2>
        <span className="modeler-check__summary" role="status">
          {plural(counts.error, 'error')} · {plural(counts.warning, 'warning')} ·{' '}
          {plural(counts.recommendation, 'recommendation')} · {plural(counts.info, 'info note')}
        </span>
        <IconButton size="small" aria-label="Close the model check" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <p className="modeler-check__note">
        {hasData
          ? 'Includes checks against the dataset loaded in the Data Lab.'
          : 'Method-independent checks only. Load data in the Data Lab to add data checks.'}
      </p>
      <ValidationList issues={issues} onFocus={focus} emptyTitle="No issues found in this model" />
    </section>
  );
}
