import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PromptGallerySection, PromptSection } from '@/lib/envision';
import type { GalleryEntry } from '@/lib/gallery';

export function PromptJump({ sections }: { sections: PromptSection[] }) {
  return (
    <label className="prompt-jump">
      <span className="visually-hidden">Jump to prompt</span>
      <select
        aria-label="Jump to prompt"
        value=""
        onChange={(event) => {
          const target = document.getElementById(`prompt-${event.target.value}`);
          const details = target?.querySelector('details');
          if (details) details.open = true;
          target?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'instant'
              : 'smooth',
            block: 'start',
          });
          target?.focus({ preventScroll: true });
        }}
      >
        <option value="" disabled>
          Jump to prompt · {sections.length}
        </option>
        {sections.map((section, index) => (
          <option key={section.id} value={section.id}>
            {index + 1}.{' '}
            {section.prompt.length > 95 ? `${section.prompt.slice(0, 95)}…` : section.prompt}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PromptSections({
  sections,
  renderEntry,
  onMore,
  onDelete,
  moreDisabled,
  submitting,
}: {
  sections: PromptGallerySection[];
  renderEntry: (entry: GalleryEntry) => ReactNode;
  onMore: (section: PromptSection) => void;
  onDelete: (section: PromptSection) => void;
  moreDisabled: (section: PromptSection) => boolean;
  submitting: boolean;
}) {
  return (
    <div className="prompt-sections">
      {sections.map((section, index) => (
        <section
          className="prompt-section"
          id={`prompt-${section.id}`}
          tabIndex={-1}
          aria-labelledby={`prompt-title-${section.id}`}
          key={section.id}
        >
          <button
            className="icon-button prompt-delete"
            title="Delete unsaved creations in this prompt"
            aria-label={`Delete prompt section ${index + 1}`}
            disabled={submitting}
            onClick={() => onDelete(section)}
          >
            <Trash2 size={16} />
          </button>
          <details open>
            <summary className="prompt-section-header">
              <ChevronRight className="prompt-chevron" size={15} />
              <h2 id={`prompt-title-${section.id}`} title={section.prompt}>
                {section.prompt}
              </h2>
              <span className="prompt-count">{section.entries.length}</span>
            </summary>
            <div className="media-grid">{section.entries.map(renderEntry)}</div>
            {!section.entries.length && (
              <p className="prompt-section-empty">
                {section.active.length
                  ? 'Waiting for the next creation…'
                  : 'No creations here yet. Load more to try this prompt again.'}
              </p>
            )}
            <footer className="load-more" id={`prompt-end-${section.id}`}>
              {section.request && (
                <button
                  className="secondary"
                  aria-label={`Load more for prompt ${index + 1}`}
                  disabled={submitting || moreDisabled(section)}
                  onClick={() => onMore(section)}
                >
                  <Plus size={16} />
                  Load more
                </button>
              )}
              {section.active.length > 0 && (
                <span>
                  {section.active.length} {section.active.length === 1 ? 'job' : 'jobs'} in queue
                </span>
              )}
            </footer>
          </details>
        </section>
      ))}
    </div>
  );
}
