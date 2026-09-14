'use client';
import { IconButton } from '@/components/ui/primitives/icon-button';
import { Button } from '@/components/ui/primitives/button';
import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Modal } from './modal';
export function SettingsDialog({
  id,
  title,
  onClose,
  children,
}: {
  id: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Modal id={id} titleId={titleId} className="generation-settings" onClose={onClose}>
      <div className="section-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton
          type="button"
          aria-label="Close generation settings"
          onClick={onClose}
          variant="ghost"
        >
          <X size={20} />
        </IconButton>
      </div>
      {children}
      <Button type="button" onClick={onClose} variant="primary" className="full done-settings">
        Done
      </Button>
    </Modal>
  );
}
