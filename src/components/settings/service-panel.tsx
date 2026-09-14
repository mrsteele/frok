import type { ComponentProps, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Card } from '@/components/ui/patterns/card';
import { Badge } from '@/components/ui/primitives/badge';
import { Spinner } from '@/components/ui/primitives/spinner';
type Props = Omit<ComponentProps<typeof Card>, 'title'> & {
  title: string;
  description: string;
  status: ReactNode;
};
export function ServicePanel({
  title,
  description,
  status,
  children,
  className = '',
  ...props
}: Props) {
  return (
    <Card {...props} className={`settings-service-panel ${className}`.trim()}>
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {status}
      </header>
      {children}
    </Card>
  );
}
export function ConnectionStatus({
  pending,
  dirty,
  connected,
  enabled,
  dirtyLabel = 'Unsaved changes',
}: {
  pending: boolean;
  dirty: boolean;
  connected: boolean;
  enabled?: boolean;
  dirtyLabel?: string;
}) {
  const tone = pending
    ? 'neutral'
    : dirty
      ? 'warning'
      : connected
        ? 'success'
        : enabled
          ? 'warning'
          : 'neutral';
  return (
    <Badge tone={tone}>
      {pending ? (
        <>
          <Spinner />
          Checking
        </>
      ) : dirty ? (
        dirtyLabel
      ) : connected ? (
        <>
          <Check size={13} />
          Connected
        </>
      ) : enabled ? (
        'Offline'
      ) : (
        'Not connected'
      )}
    </Badge>
  );
}
