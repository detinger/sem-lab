/** Reads the app's current state (modeler model, Data Lab mapping, analysis form) for evaluators. */
import { toConfiguration, useAnalysisConfig } from '@/features/analysis/config';
import { useDataLab } from '@/features/data-lab/store';
import { useModeler } from '@/features/modeler/store';
import type { EvalContext } from './evaluate';

export function currentContext(): EvalContext {
  const { model } = useModeler.getState();
  const transformations = useDataLab.getState().dataset?.transformations ?? [];
  const parsed = toConfiguration(useAnalysisConfig.getState().config);
  return {
    model,
    mapping: {
      indicators: model.indicators.map((i) => ({
        name: i.name,
        column: i.column,
        scale: i.scale,
        reverseScored: i.reverseScored,
      })),
      transformations: transformations.map(
        (t): EvalContext['mapping']['transformations'][number] => {
          if (t.kind === 'reverse')
            return { kind: t.kind, column: t.column, as: t.as, scale: t.scale };
          return { kind: t.kind };
        },
      ),
    },
    analysis: parsed.ok ? parsed.analysis : null,
    analysisProblem: parsed.ok ? null : firstProblem(parsed.problems),
  };
}

function firstProblem(problems: object): string | null {
  return (
    (Object.values(problems) as unknown[]).find((p): p is string => typeof p === 'string') ?? null
  );
}
