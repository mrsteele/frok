'use client';
import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Modal } from './modal';

export function SettingsDialog({ id, title, onClose, children }: {
  id: string; title: string; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  return <Modal id={id} titleId={titleId} className="generation-settings" onClose={onClose}>
    <div className="section-header">
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="icon-button" aria-label="Close generation settings" onClick={onClose}><X size={20} /></button>
    </div>
    {children}
    <button type="button" className="primary full done-settings" onClick={onClose}>Done</button>
  </Modal>;
}
