import type { ComponentProps } from 'react';
import { Spinner } from './spinner';

export type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'compact' | 'default';
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'default',
  loading = false,
  disabled,
  type = 'button',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy']}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
