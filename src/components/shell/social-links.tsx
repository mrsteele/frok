import { Github } from 'lucide-react';

import { product } from '../../../desktop/product.mjs';

export function SocialLinks({ labels = false }: { labels?: boolean }) {
  return (
    <div className={`social-links ${labels ? 'with-labels' : ''}`}>
      <a
        href={product.githubUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Frok on GitHub"
        title="GitHub"
      >
        <Github size={16} />
        {labels && 'GitHub'}
      </a>
      <a
        href={product.supportUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Support on X — Matt_R_Steele"
        title="Support on X"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.4l8.1-9.3L.8 2h6.5l4.4 6.7L18.9 2Zm-1.1 18h1.7L6.3 4H4.5l13.3 16Z" />
        </svg>
        {labels && 'Support on X'}
      </a>
    </div>
  );
}
