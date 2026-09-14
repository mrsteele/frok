'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  assetBackTarget,
  navigationDepth,
  studioRoute,
  trackBrowserNavigation,
} from '@/lib/navigation';

export function NavigationTracker() {
  useEffect(() => trackBrowserNavigation(window), []);
  return null;
}

export function BackButton({
  fallback = '/',
  disabled = false,
}: {
  fallback?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  function goBack() {
    if (studioRoute(window.location.pathname)?.view === 'media') {
      const target = assetBackTarget(window.history.state, fallback);
      if ('steps' in target) window.history.go(target.steps);
      else router.replace(target.href);
      return;
    }
    if (navigationDepth(window.history.state) > 0) router.back();
    else router.replace(fallback);
  }
  return (
    <button disabled={disabled} className="page-back" onClick={goBack}>
      <ArrowLeft size={16} />
      Back
    </button>
  );
}

export function PageShell({
  title,
  description,
  fallback = '/',
  className = '',
  busy = false,
  showBack = true,
  children,
}: {
  title: string;
  description?: string;
  fallback?: string;
  className?: string;
  busy?: boolean;
  showBack?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [pathname]);
  return (
    <section className={`route-page ${className}`}>
      {showBack && <BackButton fallback={fallback} disabled={busy} />}
      <header className="page-heading">
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}
