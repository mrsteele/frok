import type { ComponentProps } from 'react';
// The standalone gallery has no Next router. Its navigation stays within the fixture.
export default function PreviewLink(props: ComponentProps<'a'>) {
  return <a {...props} />;
}
