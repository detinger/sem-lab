import type { SemModel } from '@sem-studio/contracts';
import { useMemo, useState } from 'react';
import { SegmentedControl } from '@/components/ui';
import { ModelDiagram } from '../ModelDiagram';
import { DemoFrame, type DemoInitial } from './controls';

type Mode = 'reflective' | 'composite-formative';

function miniModel(mode: Mode): SemModel {
  return {
    constructs: [
      { id: 'c_q', name: 'Quality', measurement: mode, indicatorIds: ['i1', 'i2', 'i3'] },
    ],
    indicators: ['q1', 'q2', 'q3'].map((n, i) => ({ id: `i${i + 1}`, name: n, column: null })),
    relationships: [],
  };
}

const CONSEQUENCES: Record<Mode, { heading: string; items: string[] }> = {
  reflective: {
    heading: 'Reflective (Mode A): the construct causes its indicators',
    items: [
      'Arrows point from the construct to each indicator; the indicators share a common cause.',
      'Indicators are interchangeable, so they should correlate strongly; dropping one rarely changes meaning.',
      'Assess with loadings, Cronbach’s α, ρC, AVE and HTMT.',
      'Each indicator has its own error term.',
    ],
  },
  'composite-formative': {
    heading: 'Composite / formative (Mode B): the indicators form the construct',
    items: [
      'Arrows point from each indicator to the construct; the construct is a weighted sum.',
      'Indicators need not correlate, and each adds unique content; dropping one changes the construct.',
      'Assess with outer weights, their significance, and collinearity (VIF), not with α or AVE.',
      'The indicators together should cover the whole domain of the concept.',
    ],
  },
};

/** Initial keys: `mode` ("reflective" | "composite-formative"). */
export function ReflectiveFormativeDemo({ initial = {} }: { initial?: DemoInitial }) {
  const [mode, setMode] = useState<Mode>(
    initial.mode === 'composite-formative' ? 'composite-formative' : 'reflective',
  );
  const model = useMemo(() => miniModel(mode), [mode]);
  const c = CONSEQUENCES[mode];
  return (
    <DemoFrame
      title="Reflective or formative measurement"
      guideline={
        <>
          Decide from theory, not from the data: ask whether a change in the construct would change
          all its indicators (reflective) or whether changing an indicator would change the
          construct (formative). Statistical criteria support, but do not make, that decision.
        </>
      }
    >
      <div className="demo__controls">
        <SegmentedControl
          aria-label="Measurement model"
          value={mode}
          onChange={(v) =>
            setMode(v === 'composite-formative' ? 'composite-formative' : 'reflective')
          }
          options={[
            { value: 'reflective', label: 'Reflective' },
            { value: 'composite-formative', label: 'Formative' },
          ]}
        />
        <ModelDiagram
          model={model}
          compact
          title={`Quality measured ${mode === 'reflective' ? 'reflectively' : 'as a composite'}`}
        />
      </div>
      <div className="demo__readouts">
        <h5 className="demo__sub">{c.heading}</h5>
        <ul className="demo__list">
          {c.items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    </DemoFrame>
  );
}
