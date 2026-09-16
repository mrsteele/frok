import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InterfacePreferences } from '@/components/shell/interface-preferences';
import Studio from '@/components/shell/studio';
import { NavigationTracker } from '@/components/shell/page-shell';
import './globals.css';
import '@/components/ui/tokens.css';
import '@/components/ui/ui.css';
import '@/components/settings/settings.css';
import '@/components/settings/pipeline-catalog.css';
import '@/components/onboarding/onboarding.css';
export const metadata: Metadata = {
  title: 'Frok — Your local imagination',
  description:
    'Create images and videos on your own machine. A private, local creative studio powered by Vpipe, ComfyUI, and Ollama.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<p className="session-bootstrap">Opening your studio…</p>}>
          <InterfacePreferences>
            <NavigationTracker />
            <Studio>{children}</Studio>
          </InterfacePreferences>
        </Suspense>
      </body>
    </html>
  );
}
