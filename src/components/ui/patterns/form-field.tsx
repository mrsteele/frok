'use client';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { FieldContext } from '../field-context';

type Props = Omit<ComponentProps<'div'>, 'title'> & {
  label: ReactNode;
  controlId?: string;
  hint?: ReactNode;
  error?: ReactNode;
  layout?: 'stack' | 'toggle';
};
export function FormField({
  label,
  controlId,
  hint,
  error,
  layout = 'stack',
  children,
  className = '',
  ...props
}: Props) {
  const generated = useId(),
    id = controlId || `field-${generated}`;
  const hintId = hint ? `${id}-hint` : undefined,
    errorId = error ? `${id}-error` : undefined;
  return (
    <FieldContext.Provider
      value={{
        id,
        describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined,
        invalid: !!error,
      }}
    >
      <div {...props} className={`ui-field ui-field--${layout} ${className}`.trim()}>
        <label className="ui-field-label" htmlFor={id}>
          {label}
        </label>
        <div className="ui-field-control">{children}</div>
        {hint && (
          <div id={hintId} className="ui-field-hint">
            {hint}
          </div>
        )}
        {error && (
          <div id={errorId} className="ui-field-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </FieldContext.Provider>
  );
}
