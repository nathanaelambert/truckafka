import { useStore, type SelectedElement } from '../store';

const DragHandleIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, cursor: 'grab', color: 'var(--text-dim)' }}>
    <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
  </svg>
);

export function DragHandle({ item, label }: { item: SelectedElement; label?: string }) {
  const { setDragItem } = useStore();

  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify(item));
        e.dataTransfer.effectAllowed = 'move';
        setDragItem(item);
      }}
      onDragEnd={() => setDragItem(null)}
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      <DragHandleIcon />
      {label && <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--accent)' }}>{label}</span>}
    </span>
  );
}
