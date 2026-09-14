import { Button, type ButtonProps } from './button';

type Props = Omit<ButtonProps, 'aria-label'> & { 'aria-label': string };
export function IconButton({
  variant = 'ghost',
  className = '',
  loading,
  children,
  ...props
}: Props) {
  return (
    <Button
      {...props}
      variant={variant}
      className={`ui-icon-button ${className}`.trim()}
      loading={loading}
    >
      {loading ? null : children}
    </Button>
  );
}
