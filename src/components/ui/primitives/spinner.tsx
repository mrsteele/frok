import type { ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';

export function Spinner({ size = 14, className = '', ...props }: ComponentProps<typeof Loader2>) {
  return (
    <Loader2
      {...props}
      size={size}
      aria-hidden="true"
      className={`ui-spinner ${className}`.trim()}
    />
  );
}
