import type { ComponentProps } from 'react';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';
export function Badge({
  tone = 'neutral',
  className = '',
  ...props
}: ComponentProps<'span'> & { tone?: Tone }) {
  return <span {...props} className={`ui-badge ui-badge--${tone} ${className}`.trim()} />;
}
