import { useState } from 'react';
import { useStore, type SelectedElement } from '../store';
import { ElementCard } from './ElementCard';

export function StagingArea() {
  const { stagedItems, reorderStaging, setDragItem, setDragOverStaging, dragOverStaging, moveToStaging } = useStore();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <div
      className="staging-area"
      style={{
        display: 'flex', gap: 4, flex: 1, overflow: 'hidden', padding: '4px 8px',
        background: dragOverStaging ? 'rgba(74,158,255,0.08)' : 'var(--bg)',
        border: dragOverStaging ? '1px dashed var(--accent)' : '1px solid var(--border)',
        transition: 'background 0.15s, border 0.15s',
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/json')) {
          e.preventDefault();
          setDragOverStaging(true);
        }
      }}
      onDragLeave={() => setDragOverStaging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOverStaging(false);
        const raw = e.dataTransfer.getData('application/json');
        if (raw) {
          try {
            const el = JSON.parse(raw) as SelectedElement;
            moveToStaging(el);
          } catch { /* ignore */ }
        }
        setDragItem(null);
      }}
    >
      {stagedItems.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-dim)', fontSize: 12 }}>
          Drag elements here to stage them
        </div>
      )}
      {stagedItems.map((el, i) => (
        <div
          key={`${el.type}-${el.id}`}
          style={{
            flex: '0 1 auto',
            minWidth: 140,
            maxWidth: 300,
            opacity: dragIndex === i ? 0.4 : 1,
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i); }}
          onDrop={() => {
            if (dragIndex !== null && dragIndex !== i) reorderStaging(dragIndex, i);
            setDragIndex(null);
            setDragOverIndex(null);
          }}
        >
          <ElementCard
            el={el}
            defaultExpanded={false}
            draggable={true}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/json', JSON.stringify(el));
              e.dataTransfer.effectAllowed = 'move';
              setDragItem(el);
              setDragIndex(i);
            }}
            onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); setDragItem(null); }}
          />
        </div>
      ))}
    </div>
  );
}
