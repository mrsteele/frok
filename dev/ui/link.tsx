import type { ComponentProps } from 'react';
import { useRouter } from './navigation';
// The standalone gallery has no Next router. Its navigation stays within the fixture.
export default function PreviewLink(props: ComponentProps<'a'>) {
  const router = useRouter();
  return <a {...props} onClick={(event) => {
    props.onClick?.(event);
    if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && props.href?.startsWith('/') && new URLSearchParams(location.search).get('view') === 'studio') {
      event.preventDefault();
      router.push(props.href);
    }
  }} />;
}
