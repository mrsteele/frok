import type { ComponentProps } from 'react';
import type { Tone } from '../primitives/badge';
export function InlineMessage({
  tone = 'neutral',
  className = '',
  role,
  ...props
}: ComponentProps<'div'> & { tone?: Tone }) {
  return (
    <div
      {...props}
      role={role || (tone === 'danger' ? 'alert' : tone === 'success' ? 'status' : undefined)}
      className={`ui-message ui-message--${tone} ${className}`.trim()}
    />
  );
}
