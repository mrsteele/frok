'use client';
import { createContext, useContext, type ComponentProps } from 'react';

type FieldState = { id: string; describedBy?: string; invalid: boolean };
export const FieldContext = createContext<FieldState | undefined>(undefined);

export function useFieldControl(
  props: Pick<ComponentProps<'input'>, 'id' | 'aria-describedby' | 'aria-invalid'>,
) {
  const field = useContext(FieldContext);
  return {
    id: props.id || field?.id,
    'aria-describedby':
      [
        ...new Set(
          [props['aria-describedby'], field?.describedBy]
            .filter(Boolean)
            .flatMap((value) => value!.split(/\s+/)),
        ),
      ].join(' ') || undefined,
    'aria-invalid': props['aria-invalid'] ?? (field?.invalid || undefined),
  };
}
