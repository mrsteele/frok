'use client';
import { useContext, type ComponentProps } from 'react';
import { FieldContext } from '@/components/ui/field-context';
import { Select } from '@/components/ui/primitives/select';
import type { Health } from '@/lib/types';
import type { PipelineKind, PipelineStatus } from '@/lib/pipelines/schema';
import { connectionNames } from '@/lib/service-config';
import { groupWorkflowsByConnection } from './workflow-options';
import { workflowDownloadAccess } from '@/lib/pipelines/download-access';

type Props = Omit<ComponentProps<'select'>, 'children' | 'value'> & {
  health?: Health;
  kind: PipelineKind;
  value: string;
  source?: boolean;
  allowNone?: boolean;
  defaultId?: string | null;
};

export function WorkflowSelect({
  health,
  kind,
  value,
  source = false,
  allowNone = false,
  defaultId,
  disabled,
  ...props
}: Props) {
  const field = useContext(FieldContext);
  const Control = field ? Select : 'select';
  const workflows = (health?.pipelines || []).filter(
    (p) => p.kind === kind && (!source || p.supportsSource),
  );
  const grouped = groupWorkflowsByConnection(workflows, health);
  function option(p: PipelineStatus) {
    const connection = health?.connections?.[p.runner],
      connected = connection?.enabled && connection.available;
    const service = connectionNames[p.runner];
    const access = workflowDownloadAccess(p);
    const accessLabel = !connected || p.ready ? '' : access.state === 'token-required' ? ' · Token needed'
      : access.state === 'denied' ? ' · Access needed'
      : access.state === 'granted' ? ' · Download access verified' : '';
    return (
      <option key={p.id} value={p.id} disabled={!connected || (!allowNone && !!p.requiresSource && !source)}>
        {p.name}
        {!allowNone && p.requiresSource && !source ? ' · Needs a starting image' : ''}
        {p.id === defaultId ? ' (Default)' : ''}
        {accessLabel}
        {connected
          ? ` · ${service}${p.ready ? '' : ' · Setup needed'}`
          : ` (requires ${service})`}
      </option>
    );
  }
  return (
    <Control {...props} value={value} disabled={disabled || !health}>
      {(allowNone || !value) && (
        <option value="" disabled={!allowNone}>
          {allowNone
            ? 'Not enabled'
            : workflows.length
              ? 'Choose a workflow'
              : 'No workflows found'}
        </option>
      )}
      {value && !workflows.some((p) => p.id === value) && (
        <option value={value} disabled>
          Selected workflow unavailable
        </option>
      )}
      {grouped.connected.map(option)}
      {!!grouped.disconnected.length && <optgroup label="Needs a connection">{grouped.disconnected.map(option)}</optgroup>}
    </Control>
  );
}
