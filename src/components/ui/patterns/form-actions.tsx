import type { ComponentProps } from 'react';
export function FormActions({
  className = '',
  align = 'end',
  ...props
}: ComponentProps<'div'> & { align?: 'start' | 'end' | 'between' }) {
  return (
    <div {...props} className={`ui-form-actions ui-form-actions--${align} ${className}`.trim()} />
  );
}
