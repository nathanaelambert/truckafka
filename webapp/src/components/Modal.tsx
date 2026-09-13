import { useState, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit?: () => void | Promise<void>;
  submitLabel?: string;
  width?: number;
}

export function Modal({ title, children, onClose, onSubmit, submitLabel = 'Save', width = 600 }: ModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (!onSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width, maxWidth: '90vw', maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        {error && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#4a2a2a', border: '1px solid var(--danger)', borderRadius: 4, color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </div>
        )}
        {onSubmit && (
          <div className="modal-actions">
            <button className="btn" onClick={onClose} disabled={loading}>Cancel</button>
            <button className="btn btn-primary" onClick={handleClick} disabled={loading}>
              {loading ? 'Saving...' : submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
