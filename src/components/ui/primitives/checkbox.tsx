'use client';
import type { ComponentProps } from 'react';
import { useFieldControl } from '../field-context';

type Props = Omit<ComponentProps<'input'>, 'type'>;
export function Checkbox({ className = '', ...props }: Props) {
  const field = useFieldControl(props);
  return (
    <input {...props} {...field} type="checkbox" className={`ui-checkbox ${className}`.trim()} />
  );
}
