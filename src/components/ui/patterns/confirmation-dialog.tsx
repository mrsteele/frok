'use client';
import { useId, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from './modal';

export function ConfirmationDialog({
  title,
  busy = false,
  onClose,
  children,
  icon = <Trash2 size={22} />,
  tone = 'danger',
}: {
  title: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  icon?: ReactNode;
  tone?: 'danger' | 'success';
}) {
  const titleId = useId();
  return (
    <Modal
      role="alertdialog"
      titleId={titleId}
      busy={busy}
      onClose={onClose}
      className="delete-confirmation"
    >
      <span className={`delete-symbol ${tone === 'success' ? 'connection-success-symbol' : ''}`}>
        {icon}
      </span>
      <h2 id={titleId}>{title}</h2>
      {children}
    </Modal>
  );
}
