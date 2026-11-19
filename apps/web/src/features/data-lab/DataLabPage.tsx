import { PageHeader } from '@/components/ui';
import { CorrelationsSection, MissingnessSection } from './Diagnostics';
import { ImportSection } from './ImportSection';
import { MappingSection } from './MappingSection';
import { PreviewTable, ProfileTable } from './DataTables';
import { DatasetHeader, EmptyDataHint, LinkBanner, QualitySummary } from './DatasetOverview';
import { ReadinessSection } from './ReadinessSection';
import { TransformationsSection } from './Transformations';
import { useDataLab } from './store';
import { useProjectData } from './useProjectData';
import './data-lab.css';

export function DataLabPage() {
  useProjectData();
  const dataset = useDataLab((s) => s.dataset);
  return (
    <>
      <PageHeader
        title="Data"
        description="Import a CSV file, map its columns to the model's indicators and check data quality. Imported data stay in your browser."
      />
      <div className="dl-page">
        <ImportSection />
        {dataset ? <DatasetHeader /> : <LinkBanner />}
        {!dataset ? <EmptyDataHint /> : null}
        {/* Inspect → map → verify: look at the data, map it, then Readiness is the go/no-go check. */}
        <QualitySummary />
        <PreviewTable />
        <ProfileTable />
        <CorrelationsSection />
        <MissingnessSection />
        <MappingSection />
        <ReadinessSection />
        <TransformationsSection />
      </div>
    </>
  );
}
