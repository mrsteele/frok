'use client';
import type { ComponentProps } from 'react';
import { useFieldControl } from '../field-context';

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  const field = useFieldControl(props);
  return <select {...props} {...field} className={`ui-select ${className}`.trim()} />;
}
