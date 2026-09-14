'use client';
import type { ComponentProps } from 'react';
import { useFieldControl } from '../field-context';

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  const field = useFieldControl(props);
  return <textarea {...props} {...field} className={`ui-textarea ${className}`.trim()} />;
}
