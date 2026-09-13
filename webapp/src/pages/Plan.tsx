import { SplitPane } from '../components/SplitPane';
import { useStore } from '../store';
import { api } from '../api';
import { useState } from 'react';
import { LoadForm, HaulForm } from '../components/Forms';

type AnyRecord = Record<string, unknown>;

function Collapsible({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span>{open ? '▼' : '▶'}</span>
      </div>
      {open && <div className="collapsible-content">{children}</div>}
    </div>
  );
}

function DraftSection() {
  const { loads, hauls } = useStore();
  const [showLoadForm, setShowLoadForm] = useState(false);
  const [showHaulForm, setShowHaulForm] = useState(false);

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button className="btn btn-sm" onClick={() => setShowLoadForm(true)}>+ Load</button>
        <button className="btn btn-sm" onClick={() => setShowHaulForm(true)}>+ Haul</button>
      </div>

      <Collapsible title={`Loads (${loads.length})`}>
        {loads.map((load) => (
          <div key={load.id as string} style={{ padding: '4px 0', borderBottom: '1px solid var(--bg-elevated)' }}>
            <span style={{ cursor: 'pointer', color: 'var(--accent)' }}
              onClick={() => useStore.getState().selectElement({ type: 'load', id: load.id as string })}>
              {load.number as string}
            </span>
            <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>{load.commodity as string}</span>
            <span style={{ color: 'var(--text-dim)', marginLeft: 8, fontSize: 11 }}>
              {load.pickup_location_name as string} → {load.dropoff_location_name as string}
            </span>
          </div>
        ))}
        {loads.length === 0 && <div style={{ color: 'var(--text-dim)' }}>No loads</div>}
      </Collapsible>

      <Collapsible title={`Hauls (${hauls.length})`}>
        {hauls.map((haul) => (
          <div key={haul.id as string} style={{ padding: '4px 0', borderBottom: '1px solid var(--bg-elevated)' }}>
            <span style={{ cursor: 'pointer', color: 'var(--accent)' }}
              onClick={() => {
                useStore.getState().selectElement({ type: 'haul', id: haul.id as string });
                useStore.getState().setPage('monitor');
              }}>
              {haul.load_number as string} → {haul.dropoff_name as string}
            </span>
            <span className={`status-badge ${haul.status}`} style={{ marginLeft: 8, fontSize: 10 }}>{haul.status as string}</span>
          </div>
        ))}
        {hauls.length === 0 && <div style={{ color: 'var(--text-dim)' }}>No hauls</div>}
      </Collapsible>

      {showLoadForm && <LoadForm onClose={() => setShowLoadForm(false)} />}
      {showHaulForm && <HaulForm isDraft onClose={() => setShowHaulForm(false)} />}
    </div>
  );
}

function RealDataSection() {
  const { loads, hauls, selectElement, setPage } = useStore();

  const selectAndNavigate = (type: 'load' | 'haul', id: string) => {
    selectElement({ type, id });
    setPage('monitor');
  };

  return (
    <div>
      <Collapsible title={`Loads (${loads.length})`}>
        {loads.map((load) => (
          <div key={load.id as string} style={{ padding: '4px 0', borderBottom: '1px solid var(--bg-elevated)' }}>
            <span style={{ cursor: 'pointer', color: 'var(--accent)' }}
              onClick={() => selectAndNavigate('load', load.id as string)}>
              {load.number as string}
            </span>
            <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>
              {load.pickup_location_name as string} → {load.dropoff_location_name as string}
            </span>
          </div>
        ))}
        {loads.length === 0 && <div style={{ color: 'var(--text-dim)' }}>No loads</div>}
      </Collapsible>

      <Collapsible title={`Hauls (${hauls.length})`}>
        {hauls.map((haul) => (
          <div key={haul.id as string} style={{ padding: '4px 0', borderBottom: '1px solid var(--bg-elevated)' }}>
            <span style={{ cursor: 'pointer', color: 'var(--accent)' }}
              onClick={() => selectAndNavigate('haul', haul.id as string)}>
              {haul.load_number as string} — {haul.driver_name as string}
            </span>
            <span className={`status-badge ${haul.status}`} style={{ marginLeft: 8, fontSize: 10 }}>{haul.status as string}</span>
          </div>
        ))}
        {hauls.length === 0 && <div style={{ color: 'var(--text-dim)' }}>No hauls</div>}
      </Collapsible>
    </div>
  );
}

export function Plan() {
  return (
    <div className="page plan-page">
      <SplitPane direction="horizontal" initialSplit={50} min={200}>
        <div className="plan-column">
          <h2>Draft Area</h2>
          <DraftSection />
        </div>
        <div className="plan-column">
          <h2>Real Data</h2>
          <RealDataSection />
        </div>
      </SplitPane>
    </div>
  );
}
