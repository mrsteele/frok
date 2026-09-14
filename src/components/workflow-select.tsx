'use client';
import type { ComponentProps } from 'react';
import type { Health } from '@/lib/types';
import type { PipelineKind } from '@/lib/pipelines/schema';
import { connectionNames } from '@/lib/service-config';

type Props = Omit<ComponentProps<'select'>, 'children' | 'value'> & {
  health?: Health; kind: PipelineKind; value: string; source?: boolean;
  allowNone?: boolean; defaultId?: string | null;
};

export function WorkflowSelect({health,kind,value,source=false,allowNone=false,defaultId,disabled,...props}:Props) {
  const workflows=(health?.pipelines||[]).filter(p=>p.kind===kind&&(!source||p.supportsSource));
  return <select {...props} value={value} disabled={disabled||!health}>
    {(allowNone||!value)&&<option value="" disabled={!allowNone}>{allowNone?'Not enabled':workflows.length?'Choose a pipeline':'No workflows found'}</option>}
    {value&&!workflows.some(p=>p.id===value)&&<option value={value} disabled>Selected workflow unavailable</option>}
    {workflows.map(p=>{
      const connection=health?.connections?.[p.runner],connected=connection?.enabled&&connection.available;
      const service=connectionNames[p.runner];
      return <option key={p.id} value={p.id} disabled={!connected}>
        {p.name}{p.id===defaultId?' (Default)':''}{connected?` · ${service}${p.ready?'':' · Setup needed'}`:` (requires ${service})`}
      </option>;
    })}
  </select>;
}
