'use client';
import { useState } from 'react';
import { DocumentationLink } from './documentation-link';

export function LegalNotice() {
  const [error, setError] = useState('');
  return <aside className="legal-notice" aria-label="Your content and responsibility">
    <strong>Your content. Your responsibility.</strong>
    <p>Frok is open source. Everything Frok stores for your studio—including prompts, media, settings and logs—stays on your device. Its developers collect none of this data; the app has no built-in reporting channel or developer remote access.</p>
    <p>Frok’s developers do not monitor or review your content. You are responsible for your inputs, generated content and how you use or share it, including required permissions and model licenses. Frok is provided “as is,” without warranty to the extent permitted by law.</p>
    <DocumentationLink page="/legal" label="Legal & responsible use" onError={setError}/>
    {error&&<p role="alert">{error}</p>}
  </aside>;
}
