'use client';
import { BookOpen } from 'lucide-react';

export function DocumentationLink({
  onError,
  page = '/documentation',
  label = 'Documentation',
  className,
}: {
  onError: (message: string) => void;
  page?: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={`/docs${page}.html`}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      onClick={(event) => {
        if (!window.frokDesktop?.openDocs) return;
        event.preventDefault();
        void window.frokDesktop
          ?.openDocs(page)
          .catch(() => onError('Documentation could not be opened.'));
      }}
    >
      <BookOpen size={17} />
      <span>{label}</span>
    </a>
  );
}
