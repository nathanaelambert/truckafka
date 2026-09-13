import { useState, useRef, useCallback, type ReactNode } from 'react';

interface SplitPaneProps {
  children: [ReactNode, ReactNode];
  direction: 'vertical' | 'horizontal';
  initialSplit?: number; // 0-100 percentage for first child
  min?: number; // min size in px for first child
  max?: number; // max size in px for first child
}

export function SplitPane({ children, direction, initialSplit = 50, min = 100, max }: SplitPaneProps) {
  const [split, setSplit] = useState(initialSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let pct: number;
    if (direction === 'horizontal') {
      pct = ((e.clientX - rect.left) / rect.width) * 100;
    } else {
      pct = ((e.clientY - rect.top) / rect.height) * 100;
    }
    pct = Math.max(0, Math.min(100, pct));

    // Apply min/max constraints
    if (direction === 'horizontal') {
      const minPct = (min / rect.width) * 100;
      const maxPct = max ? (max / rect.width) * 100 : 100;
      pct = Math.max(minPct, Math.min(maxPct, pct));
    } else {
      const minPct = (min / rect.height) * 100;
      const maxPct = max ? (max / rect.height) * 100 : 100;
      pct = Math.max(minPct, Math.min(maxPct, pct));
    }

    setSplit(pct);
  }, [direction, min, max]);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={containerRef}
      className={direction === 'horizontal' ? 'split-horizontal' : 'split-vertical'}
      style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: direction === 'horizontal' ? 'row' : 'column' }}
    >
      <div style={{
        [direction === 'horizontal' ? 'width' : 'height']: `${split}%`,
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        flexDirection: direction === 'horizontal' ? 'row' : 'column',
      } as React.CSSProperties}>
        {children[0]}
      </div>
      <div
        className={`split-divider ${direction}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div style={{
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: direction === 'horizontal' ? 'row' : 'column',
      }}>
        {children[1]}
      </div>
    </div>
  );
}
