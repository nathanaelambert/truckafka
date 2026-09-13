import { useEffect } from 'react';
import { SplitPane } from '../components/SplitPane';
import { MapView } from '../components/MapView';
import { ControlPanel } from '../components/ControlPanel';
import { OrdersPanel } from '../components/OrdersPanel';
import { Timeline } from '../components/Timeline';
import { useStore } from '../store';

function DetentionBanner() {
  const { detentionAlerts, dismissDetentionAlert } = useStore();

  // Auto-dismiss alerts after 10 seconds
  useEffect(() => {
    if (detentionAlerts.length === 0) return;
    const timer = setTimeout(() => {
      dismissDetentionAlert(0);
    }, 10000);
    return () => clearTimeout(timer);
  }, [detentionAlerts, dismissDetentionAlert]);

  if (detentionAlerts.length === 0) return null;

  return (
    <div style={{ position: 'fixed', top: 48, right: 12, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
      {detentionAlerts.map((alert, i) => (
        <div key={i} style={{
          background: 'var(--bg-panel)', border: '1px solid var(--warning)', borderRadius: 8,
          padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', position: 'relative',
          animation: 'fadeOut 10s ease-in forwards',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)', textTransform: 'capitalize' }}>
              {alert.eventType} Detention Alert
            </span>
            <button onClick={() => dismissDetentionAlert(i)} style={{
              position: 'absolute', top: 4, right: 4, background: 'transparent', border: 'none',
              color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1,
            }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)' }}>
            Load <strong>{alert.loadNumber}</strong> — truck is {alert.eventType} at <strong>{alert.locationName}</strong>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            📞 Notify host: <strong style={{ color: 'var(--accent)' }}>{alert.phone}</strong>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Started at {alert.time.toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Monitor() {
  return (
    <div className="page">
      <DetentionBanner />
      <SplitPane direction="vertical" initialSplit={75} min={100}>
        <SplitPane direction="horizontal" initialSplit={55} min={200}>
          <MapView />
          <SplitPane direction="horizontal" initialSplit={50} min={150}>
            <OrdersPanel />
            <ControlPanel />
          </SplitPane>
        </SplitPane>
        <Timeline />
      </SplitPane>
    </div>
  );
}
