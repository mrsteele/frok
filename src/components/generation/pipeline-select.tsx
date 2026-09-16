'use client';
import type { Generation, Health } from '@/lib/types';
import { selectedPipeline, type PipelineKind } from '@/lib/pipelines/schema';
import { WorkflowSelect } from './workflow-select';
export function PipelineSelect({
  kind,
  value,
  health,
  source = false,
  disabled,
  onChange,
}: {
  kind: PipelineKind;
  value?: string;
  health?: Health;
  source?: boolean;
  disabled?: boolean;
  onChange: (change: Partial<Generation>) => void;
}) {
  const defaultId = health?.pipelineSelections?.[kind],
    selectedId = value || defaultId || '';
  return (
    <label className="pipeline-select">
      Workflow
      <WorkflowSelect
        health={health}
        kind={kind}
        source={source}
        value={selectedId}
        defaultId={defaultId}
        disabled={disabled}
        onChange={(e) => {
          const id = e.target.value === defaultId ? undefined : e.target.value || undefined,
            p = selectedPipeline(health, kind, id);
          onChange({
            pipelineId: id,
            ...(p
              ? {
                  quality: p.controls.qualities[0],
                  duration: p.controls.durations[0] || 6,
                  aspect: p.controls.aspects[0],
                }
              : {}),
          });
        }}
      />
    </label>
  );
}
