'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ id, titleId, className, role = 'dialog', busy = false, onClose, children }: {
  id?: string; titleId: string; className: string; role?: 'dialog' | 'alertdialog';
  busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null), backdropPressed = useRef(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || !dialog.current) return;
    const panel = dialog.current, previous = document.activeElement;
    const overflow = document.documentElement.style.overflow;
    // Native modal dialogs keep focus inside and make the rest of the page inert.
    panel.showModal();
    document.documentElement.style.overflow = 'hidden';
    return () => {
      panel.close();
      document.documentElement.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [mounted]);
  return mounted ? createPortal(<dialog ref={dialog} id={id} role={role} aria-modal="true" aria-labelledby={titleId} aria-busy={busy} className={className}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length);
      const first = controls[0], last = controls.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (active === first || active === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }}
    onPointerDown={event => { backdropPressed.current = event.target === event.currentTarget; }}
    onClick={event => {
      if (event.target !== event.currentTarget || !backdropPressed.current || busy) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    {children}
  </dialog>, document.body) : null;
}
