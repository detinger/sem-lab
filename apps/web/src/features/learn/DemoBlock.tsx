import type { DemoId } from './schema';
import { BootstrapDemo } from './demos/BootstrapDemo';
import {
  F2Demo,
  HtmtDemo,
  IpmaRescaleDemo,
  MediationDemo,
  ReliabilityDemo,
  RmseaCfiDemo,
  VifDemo,
} from './demos/BasicDemos';
import type { DemoInitial } from './demos/controls';
import { ReflectiveFormativeDemo } from './demos/ReflectiveFormativeDemo';

const DEMOS: Record<DemoId, (p: { initial?: DemoInitial }) => React.JSX.Element> = {
  'reliability-from-loadings': ReliabilityDemo,
  htmt: HtmtDemo,
  vif: VifDemo,
  f2: F2Demo,
  mediation: MediationDemo,
  bootstrap: BootstrapDemo,
  'ipma-rescale': IpmaRescaleDemo,
  'rmsea-cfi': RmseaCfiDemo,
  'reflective-formative': ReflectiveFormativeDemo,
};

export function Demo({ id, initial }: { id: DemoId; initial: DemoInitial }) {
  const Component = DEMOS[id];
  return <Component initial={initial} />;
}
