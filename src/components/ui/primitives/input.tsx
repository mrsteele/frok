'use client';
import type { ComponentProps } from 'react';
import { useFieldControl } from '../field-context';

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  const field = useFieldControl(props);
  return <input {...props} {...field} className={`ui-input ${className}`.trim()} />;
}
