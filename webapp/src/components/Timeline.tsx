import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { RefHeader } from './ElementHeader';
import type { SelectedElement } from '../store';
import { computeEventState } from '../store';

interface TimelineEvent {
  id: string; type: string;
  start_time: string; end_time: string;
  truck_id: string | null; load_id: string | null; trailer_id: string | null; driver_id: string | null;
  start_location_id: string; end_location_id: string;
  start_location_name: string | null; end_location_name: string | null;
  motion_id: string | null; distance_m: number | null;
}

const EVENT_COLORS: Record<string, string> = {
  bobtail: '#fb923c', deadmile: '#fbbf24', haul: '#4a9eff',
  loading: '#4ade80', unloading: '#a3e635', attach: '#a78bfa', detach: '#c084fc',
  idle: '#6b7280', road_event: '#fb923c',
};

const SPEEDS = [1, 2, 5, 10, 60, 300];

export function Timeline() {
  const { viewTime, isLiveTime, setViewTime, setLiveTime, selectedEventId, setSelectedEventId, setTimelineRange } = useStore();
  const orders = useStore(state => state.orders);
  const roadEvents = useStore(state => state.roadEvents);
  const hiddenItems = useStore(state => state.hiddenItems);
  const toggleItemVisible = useStore(state => state.toggleItemVisible);
  const moveOrderEvent = useStore(state => state.moveOrderEvent);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [playing, setPlaying] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrollingRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScrollRef = useRef(false);
  const [hoveringPlayhead, setHoveringPlayhead] = useState(false);
  const [scrollTick, setScrollTick] = useState(0); // triggers re-render on scroll for grid lines

  // Order event drag state
  const orderDragRef = useRef<{ orderId: string; eventId: string; pointerId: number } | null>(null);

  const DAY_MS = 24 * 3600 * 1000;
  const MAX_DAYS = 14; // cap at ±14 days from now
  const [rangeStart, setRangeStart] = useState(() => new Date(Date.now() - 2 * DAY_MS));
  const [rangeEnd, setRangeEnd] = useState(() => new Date(Date.now() + 2 * DAY_MS));
  const fetchedRangeRef = useRef({ start: rangeStart.getTime(), end: rangeEnd.getTime() });
  const start = rangeStart;
  const end = rangeEnd;
  const totalMs = end.getTime() - start.getTime();
  const rangeHours = Math.ceil(totalMs / (3600 * 1000));
  const pxPerMs = zoom * 20 / (3600 * 1000);

  // Push timeline range to store (for MapView to filter visible events)
  useEffect(() => { setTimelineRange(start, end); }, [start, end, setTimelineRange]);

  // Fetch events whenever the fetched range doesn't cover the current range
  useEffect(() => {
    const needFetchLeft = start.getTime() < fetchedRangeRef.current.start;
    const needFetchRight = end.getTime() > fetchedRangeRef.current.end;
    if (!needFetchLeft && !needFetchRight) return;
    const fetchStart = new Date(Math.min(start.getTime(), fetchedRangeRef.current.start));
    const fetchEnd = new Date(Math.max(end.getTime(), fetchedRangeRef.current.end));
    fetchedRangeRef.current = { start: fetchStart.getTime(), end: fetchEnd.getTime() };
    api.getEvents(fetchStart.toISOString(), fetchEnd.toISOString()).then((data: unknown) => {
      const d = data as { events: TimelineEvent[] };
      const fetched = d.events || [];
      setEvents(prev => {
        const ids = new Set(fetched.map(e => e.id));
        const merged = [...prev.filter(e => !ids.has(e.id)), ...fetched];
        merged.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        return merged;
      });
    }).catch(() => {});
  }, [start, end]);

  // Auto-recenter timeline on selected event
  useEffect(() => {
    if (!selectedEventId || !scrollRef.current) return;
    const eventX = (useStore.getState().viewTime.getTime() - start.getTime()) * pxPerMs;
    programmaticScrollRef.current = true;
    scrollRef.current.scrollLeft = Math.max(0, eventX - scrollRef.current.clientWidth / 2);
  }, [selectedEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;
    const speed = SPEEDS[speedIdx];
    lastTickRef.current = performance.now();

    if (scrollRef.current) {
      const initialX = (useStore.getState().viewTime.getTime() - start.getTime()) * pxPerMs;
      scrollRef.current.scrollLeft = Math.max(0, initialX - scrollRef.current.clientWidth / 2);
    }

    const tick = (now: number) => {
      const elapsed = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      const current = useStore.getState().viewTime;

      if (useStore.getState().isLiveTime) {
        const realNow = new Date();
        setViewTime(realNow);
      } else {
        const next = new Date(current.getTime() + elapsed * 1000 * speed);
        setViewTime(next);
      }

      // Check for detention (loading/unloading events reached by playback)
      useStore.getState().checkDetention();

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speedIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeToX = useCallback((t: Date) => (t.getTime() - start.getTime()) * pxPerMs, [start, pxPerMs]);

  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const isScrollbar = (e.clientX > rect.right - 15) || (e.clientY > rect.bottom - 15);
    if (isScrollbar) return;
    // Don't clear selected event or start dragging if clicking inside the tooltip
    const target = e.target as HTMLElement;
    if (target.closest('[data-event-tooltip]')) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedEventId(null);
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const t = new Date(start.getTime() + x / pxPerMs);
    setViewTime(t);
    useStore.getState().checkDetention();
  }, [start, pxPerMs, setViewTime, setSelectedEventId]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const t = new Date(start.getTime() + x / pxPerMs);
    setViewTime(t);
    useStore.getState().checkDetention();
  }, [start, pxPerMs, setViewTime]);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  const onUserScroll = useCallback(() => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    userScrollingRef.current = true;
    if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false;
    }, 2000);
    setScrollTick(t => t + 1);

    // Dynamic range extension: if near left/right edge, grow by 1 day (capped at MAX_DAYS)
    const container = scrollRef.current;
    if (!container) return;
    const nearLeft = container.scrollLeft < container.clientWidth * 0.5;
    const nearRight = (container.scrollWidth - container.scrollLeft - container.clientWidth) < container.clientWidth * 0.5;
    const nowMs = Date.now();
    if (nearLeft) {
      setRangeStart(prev => {
        const minStart = nowMs - MAX_DAYS * DAY_MS;
        const newStart = Math.max(minStart, prev.getTime() - DAY_MS);
        return newStart !== prev.getTime() ? new Date(newStart) : prev;
      });
    }
    if (nearRight) {
      setRangeEnd(prev => {
        const maxEnd = nowMs + MAX_DAYS * DAY_MS;
        const newEnd = Math.min(maxEnd, prev.getTime() + DAY_MS);
        return newEnd !== prev.getTime() ? new Date(newEnd) : prev;
      });
    }
  }, []);

  // Zoom around playhead
  const onZoomChange = useCallback((newZoom: number) => {
    if (!scrollRef.current) { setZoom(newZoom); return; }
    const oldPxPerMs = zoom * 20 / (3600 * 1000);
    const newPxPerMs = newZoom * 20 / (3600 * 1000);
    const container = scrollRef.current;
    const playheadX = (viewTime.getTime() - start.getTime()) * oldPxPerMs;
    const playheadScreenX = playheadX - container.scrollLeft;
    const ratio = playheadScreenX / container.clientWidth;
    setZoom(newZoom);
    // After re-render, scrollLeft will be adjusted
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const newPlayheadX = (viewTime.getTime() - start.getTime()) * newPxPerMs;
      scrollRef.current.scrollLeft = newPlayheadX - ratio * scrollRef.current.clientWidth;
    });
  }, [zoom, start, viewTime]);

  // SHIFT + SCROLL to zoom
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!e.shiftKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    onZoomChange(Math.max(0.5, Math.min(10, zoom + delta)));
  }, [zoom, onZoomChange]);

  const recenterOnPlayback = useCallback(() => {
    if (!scrollRef.current) return;
    const playheadX = (useStore.getState().viewTime.getTime() - start.getTime()) * pxPerMs;
    programmaticScrollRef.current = true;
    scrollRef.current.scrollLeft = Math.max(0, playheadX - scrollRef.current.clientWidth / 2);
  }, [start, pxPerMs]);

  const recenterOnNow = useCallback(() => {
    if (!scrollRef.current) return;
    const nowX = (Date.now() - start.getTime()) * pxPerMs;
    programmaticScrollRef.current = true;
    scrollRef.current.scrollLeft = Math.max(0, nowX - scrollRef.current.clientWidth / 2);
  }, [start, pxPerMs]);

  // Auto-recenter on playback when the app launches
  const didAutoCenterRef = useRef(false);
  useEffect(() => {
    if (didAutoCenterRef.current) return;
    didAutoCenterRef.current = true;
    if (scrollRef.current) {
      const playheadX = (useStore.getState().viewTime.getTime() - start.getTime()) * pxPerMs;
      programmaticScrollRef.current = true;
      scrollRef.current.scrollLeft = Math.max(0, playheadX - scrollRef.current.clientWidth / 2);
    }
  }, [start, pxPerMs]);

  // ── Order event drag handlers ──────────────────────────────
  const xToTime = useCallback((clientX: number): number => {
    if (!scrollRef.current) return 0;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollRef.current.scrollLeft;
    return start.getTime() + x / pxPerMs;
  }, [start, pxPerMs]);

  const onOrderEventPointerDown = useCallback((e: React.PointerEvent, orderId: string, eventId: string) => {
    e.stopPropagation();
    orderDragRef.current = { orderId, eventId, pointerId: e.pointerId };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onOrderEventPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = orderDragRef.current;
    if (!drag) return;
    e.stopPropagation();
    const newStartMs = xToTime(e.clientX);
    moveOrderEvent(drag.orderId, drag.eventId, newStartMs);
  }, [xToTime, moveOrderEvent]);

  const recomputeEventDuration = useStore(state => state.recomputeEventDuration);

  const onOrderEventPointerUp = useCallback((e: React.PointerEvent) => {
    const drag = orderDragRef.current;
    if (!drag) return;
    e.stopPropagation();
    try { (e.target as HTMLElement).releasePointerCapture(drag.pointerId); } catch { /* ignore */ }
    orderDragRef.current = null;
    // After drag ends, recompute duration for haul/deadmile events
    recomputeEventDuration(drag.orderId, drag.eventId);
  }, [recomputeEventDuration]);

  // Safety: window-level pointerup to catch cases where pointer capture is lost
  // during re-render (div moves position, browser fires pointerup on document)
  useEffect(() => {
    const handler = () => { orderDragRef.current = null; };
    window.addEventListener('pointerup', handler);
    return () => window.removeEventListener('pointerup', handler);
  }, []);

  // Smart grid: pick the smallest "nice" interval that gives >=80px between marks
  const INTERVALS: { ms: number; format: Intl.DateTimeFormatOptions; majorEvery: number }[] = [
    { ms: 60 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }, majorEvery: 15 },
    { ms: 5 * 60 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }, majorEvery: 6 },
    { ms: 15 * 60 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }, majorEvery: 4 },
    { ms: 30 * 60 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }, majorEvery: 4 },
    { ms: 3600 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }, majorEvery: 6 },
    { ms: 2 * 3600 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', hour12: false }, majorEvery: 6 },
    { ms: 3 * 3600 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', hour12: false }, majorEvery: 8 },
    { ms: 6 * 3600 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', hour12: false }, majorEvery: 4 },
    { ms: 12 * 3600 * 1000, format: { month: 'short', day: '2-digit', hour: '2-digit', hour12: false }, majorEvery: 2 },
    { ms: 24 * 3600 * 1000, format: { month: 'short', day: '2-digit', weekday: 'short' }, majorEvery: 7 },
    { ms: 7 * 24 * 3600 * 1000, format: { month: 'short', day: '2-digit' }, majorEvery: 4 },
  ];
  const MIN_PX_BETWEEN = 80;
  const chosen = INTERVALS.find(iv => iv.ms * pxPerMs >= MIN_PX_BETWEEN) || INTERVALS[INTERVALS.length - 1];
  const intervalMs = chosen.ms;
  const intervalStep = intervalMs / (3600 * 1000); // in hours for the loop

  // Compute visible range (with buffer) in fractional hours
  const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
  const clientW = scrollRef.current?.clientWidth ?? 0;
  const visStartMs = start.getTime() + (scrollLeft - clientW) / pxPerMs;
  const visEndMs = start.getTime() + (scrollLeft + 2 * clientW) / pxPerMs;
  // Align to interval boundary
  const firstTickMs = Math.floor(visStartMs / intervalMs) * intervalMs;
  const lastTickMs = Math.ceil(visEndMs / intervalMs) * intervalMs;

  const gridLines: { x: number; label: string; major: boolean }[] = [];
  let tickIdx = 0;
  for (let ms = firstTickMs; ms <= lastTickMs; ms += intervalMs) {
    const t = new Date(ms);
    gridLines.push({
      x: (ms - start.getTime()) * pxPerMs,
      label: t.toLocaleString('en-CA', { timeZone: 'America/Toronto', ...chosen.format }),
      major: tickIdx % chosen.majorEvery === 0,
    });
    tickIdx++;
  }

  const playheadX = timeToX(viewTime);
  const nowX = timeToX(new Date());
  const speed = SPEEDS[speedIdx];
  const isLive = isLiveTime && speed === 1;
  const mode = isLive ? 'live' : viewTime.getTime() < Date.now() - 5000 ? 'past' : viewTime.getTime() > Date.now() + 5000 ? 'future' : 'live';

  const isHidden = (type: string, id: string) => hiddenItems[type]?.has(id) ?? false;

  const now = new Date();

  // Collect event IDs that belong to visible orders — those are shown in order rows, skip them in regular groups
  const orderEventIds = new Set<string>();
  for (const order of orders) {
    if (!isHidden('order', order.id)) {
      for (const ev of order.events) orderEventIds.add(ev.id);
    }
  }

  const visibleEvents = events.filter(ev => {
    if (orderEventIds.has(ev.id)) return false; // shown in order group, don't duplicate
    if (ev.truck_id && !isHidden('truck', ev.truck_id)) return true;
    if (ev.load_id && !isHidden('load', ev.load_id)) return true;
    if (ev.trailer_id && !isHidden('trailer', ev.trailer_id)) return true;
    if (ev.driver_id && !isHidden('driver', ev.driver_id)) return true;
    return false;
  });

  // Build order event groups
  const orderGroupMeta = new Map<string, { orderId: string; label: string; hidden: boolean }>();
  const orderBgBands: { x: number; w: number; color: string }[] = [];

  for (const order of orders) {
    const hidden = isHidden('order', order.id);
    const key = `order-${order.id}`;
    orderGroupMeta.set(key, { orderId: order.id, label: `Order for ${order.load_number}`, hidden });

    if (!hidden) {
      // Background bands for pickup (dark green) and dropoff (dark red) windows
      // Read from individual events (supports merged orders with multiple windows)
      const hasEventWindows = order.events.some(e => (e.type === 'loading' && e.pickup_after) || (e.type === 'unloading' && e.dropoff_after));
      if (hasEventWindows) {
        for (const ev of order.events) {
          if (ev.type === 'loading' && ev.pickup_after && ev.pickup_before) {
            const px = timeToX(new Date(ev.pickup_after));
            const pw = timeToX(new Date(ev.pickup_before)) - px;
            if (pw > 0) orderBgBands.push({ x: px, w: pw, color: 'rgba(34, 80, 34, 0.25)' });
          }
          if (ev.type === 'unloading' && ev.dropoff_after && ev.dropoff_before) {
            const dx = timeToX(new Date(ev.dropoff_after));
            const dw = timeToX(new Date(ev.dropoff_before)) - dx;
            if (dw > 0) orderBgBands.push({ x: dx, w: dw, color: 'rgba(80, 34, 34, 0.25)' });
          }
        }
      } else {
        const pickupX = timeToX(new Date(order.pickup_after));
        const pickupW = timeToX(new Date(order.pickup_before)) - pickupX;
        if (pickupW > 0) orderBgBands.push({ x: pickupX, w: pickupW, color: 'rgba(34, 80, 34, 0.25)' });
        const dropoffX = timeToX(new Date(order.dropoff_after));
        const dropoffW = timeToX(new Date(order.dropoff_before)) - dropoffX;
        if (dropoffW > 0) orderBgBands.push({ x: dropoffX, w: dropoffW, color: 'rgba(80, 34, 34, 0.25)' });
      }
    }
  }

  const elementGroups = new Map<string, TimelineEvent[]>();
  for (const ev of visibleEvents) {
    const actorId = ev.truck_id || ev.load_id || ev.trailer_id || ev.driver_id || ev.id;
    const actorType = ev.truck_id ? 'truck' : ev.load_id ? 'load' : ev.trailer_id ? 'trailer' : ev.driver_id ? 'driver' : 'event';
    const key = `${actorType}-${actorId}`;
    if (!elementGroups.has(key)) elementGroups.set(key, []);
    elementGroups.get(key)!.push(ev);
  }

  // Add order event groups
  for (const order of orders) {
    if (isHidden('order', order.id)) continue;
    const key = `order-${order.id}`;
    const orderEvents: TimelineEvent[] = order.events.map(ev => ({
      id: ev.id,
      type: ev.type,
      start_time: ev.start_time,
      end_time: ev.end_time,
      truck_id: ev.truck_id,
      load_id: ev.load_id,
      trailer_id: ev.trailer_id,
      driver_id: ev.driver_id,
      start_location_id: ev.start_location_id,
      end_location_id: ev.end_location_id,
      start_location_name: null,
      end_location_name: null,
      motion_id: ev.type === 'haul' ? ev.id : null,
      distance_m: ev.distance_m ?? null,
    }));
    elementGroups.set(key, orderEvents);
  }

  // Add road event groups
  for (const re of roadEvents) {
    const reId = re.id as string;
    if (isHidden('road_event', reId)) continue;
    const key = `road_event-${reId}`;
    const title = (re.title as string) || 'Road Event';
    const startAt = re.start_at as string;
    const endAt = (re.end_at as string) || startAt;
    const reEvents: TimelineEvent[] = [{
      id: reId,
      type: 'road_event',
      start_time: startAt,
      end_time: endAt,
      truck_id: null, load_id: null, trailer_id: null, driver_id: null,
      start_location_id: '', end_location_id: '',
      start_location_name: title, end_location_name: title,
      motion_id: null, distance_m: null,
    }];
    elementGroups.set(key, reEvents);
    // Add to orderGroupMeta for row labels
    orderGroupMeta.set(key, { orderId: reId, label: title, hidden: false });
  }

  const rowHeight = 18;
  const headerHeight = 24;
  const totalWidth = totalMs * pxPerMs;

  return (
    <div className="monitor-timeline" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="timeline-bar" style={{ position: 'relative' }}>
        <div style={{ flex: 1 }} />
        <button onClick={() => { if (playing) setPlaying(false); else setPlaying(true); }} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: playing ? 'var(--danger)' : 'var(--accent)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
          {playing ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg> : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
        </button>
        <button onClick={() => { setLiveTime(); setSpeedIdx(0); }} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--bg-elevated)', background: isLive ? 'var(--success)' : 'transparent', color: isLive ? '#000' : 'var(--text-dim)', cursor: 'pointer', fontSize: 11, fontWeight: isLive ? 700 : 400 }}>Now</button>
        <button onClick={() => setSpeedIdx((speedIdx + 1) % SPEEDS.length)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--bg-elevated)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>{SPEEDS[speedIdx]}x</button>
        <span style={{ fontSize: 11, color: isLive ? 'var(--success)' : mode === 'past' ? 'var(--text-dim)' : 'var(--warning)' }}>
          {isLive ? '● LIVE' : mode === 'past' ? '◀ PAST' : mode === 'future' ? '▶ FUTURE' : '● LIVE'}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={recenterOnNow} title="Recenter on Now" style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--bg-elevated)', background: 'transparent', color: 'var(--success)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>⊚ Now</button>
          <button onClick={recenterOnPlayback} title="Recenter on Playback" style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--bg-elevated)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>⊚ Play</button>
          <button onClick={() => onZoomChange(Math.max(0.5, zoom - 0.25))} title="Zoom out" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
          </button>
          <input type="range" min={0.5} max={10} step={0.25} value={zoom} onChange={(e) => onZoomChange(parseFloat(e.target.value))} title="Zoom (Shift+Scroll)" style={{ width: 80, accentColor: 'var(--accent)', cursor: 'pointer' }} />
          <button onClick={() => onZoomChange(Math.min(10, zoom + 0.25))} title="Zoom in" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" /></svg>
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', height: 22, marginBottom: 4 }}>
        {(playing || hoveringPlayhead) && scrollRef.current && (() => {
          const scrollLeft = scrollRef.current.scrollLeft;
          const containerWidth = scrollRef.current.clientWidth;
          const tooltipX = playheadX - scrollLeft;
          if (tooltipX < 0 || tooltipX > containerWidth) return null;
          const clampedX = Math.max(60, Math.min(containerWidth - 60, tooltipX));
          return (
            <div style={{ position: 'absolute', left: clampedX, top: 0, transform: 'translateX(-50%)', zIndex: 30, background: 'var(--bg-panel)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap', fontFamily: 'monospace', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', pointerEvents: 'none' }}>
              {viewTime.toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </div>
          );
        })()}
      </div>

      <div ref={scrollRef} onScroll={onUserScroll} style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', position: 'relative', cursor: dragging.current ? 'grabbing' : 'pointer', userSelect: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel}>
        <div style={{ width: Math.max(totalWidth, 1000), position: 'relative', minHeight: '100%' }}>
          <div style={{ position: 'sticky', top: 0, height: headerHeight, zIndex: 5, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
            {gridLines.map((g, i) => (<div key={i} style={{ position: 'absolute', left: g.x, top: 0, height: headerHeight, display: 'flex', alignItems: 'center' }}><div style={{ width: 1, height: g.major ? '100%' : '50%', background: g.major ? 'var(--border)' : 'var(--bg-elevated)' }} />{g.major && <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 4, whiteSpace: 'nowrap' }}>{g.label}</span>}</div>))}
          </div>

          <div style={{ position: 'absolute', left: nowX, top: 0, bottom: 0, width: 2, background: 'var(--success)', zIndex: 4, opacity: 0.5 }} />

          <div style={{ position: 'relative', paddingTop: 2 }}>
            {/* Background bands for order pickup/dropoff windows */}
            {orderBgBands.map((band, i) => (
              <div key={`bg-${i}`} style={{ position: 'absolute', left: band.x, top: 0, bottom: 0, width: band.w, background: band.color, zIndex: 0, pointerEvents: 'none' }} />
            ))}

            {Array.from(elementGroups.entries()).map(([key, evs]) => {
              const isOrderGroup = key.startsWith('order-');
              const orderMeta = isOrderGroup ? orderGroupMeta.get(key) : null;
              const orderObj = isOrderGroup ? orders.find(o => o.id === key.slice(6)) : null;

              return (
                <div key={key} style={{ height: rowHeight, position: 'relative', borderBottom: '1px solid var(--bg)' }}>
                  {/* Sticky row label for order groups */}
                  {isOrderGroup && orderMeta && (
                    <div
                      onClick={() => toggleItemVisible('order', orderMeta.orderId)}
                      style={{
                        position: 'sticky', left: 0, zIndex: 8, background: 'var(--bg-panel)',
                        fontSize: 9, fontWeight: 600, padding: '0 6px', height: rowHeight,
                        display: 'flex', alignItems: 'center', cursor: 'pointer',
                        color: orderMeta.hidden ? 'var(--text-dim)' : 'var(--accent)',
                        borderRight: '1px solid var(--border)', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120,
                        flexShrink: 0, pointerEvents: 'auto',
                      }}
                      title={orderMeta.label}
                    >
                      {orderMeta.label}
                    </div>
                  )}

                  {evs.map((ev, i) => {
                    const x = timeToX(new Date(ev.start_time));
                    const w = Math.max(2, timeToX(new Date(ev.end_time)) - x);
                    const color = EVENT_COLORS[ev.type] || '#6b7280';
                    const isSel = selectedEventId === ev.id;

                    // Check if this is a draggable incoming order event
                    const evState = orderObj ? computeEventState(
                      orderObj.events.find(e => e.id === ev.id) || ev as any,
                      !!orderObj.haul_id, now
                    ) : null;
                    const isDraggable = evState === 'incoming' &&
                      ev.type !== 'idle';

                    if (isDraggable && orderMeta) {
                      return (
                        <div key={i}
                          onPointerDown={(e) => onOrderEventPointerDown(e, orderMeta.orderId, ev.id)}
                          onPointerMove={onOrderEventPointerMove}
                          onPointerUp={(e) => {
                            onOrderEventPointerUp(e);
                            const cur = useStore.getState().selectedEventId;
                            if (cur === ev.id) { useStore.getState().setSelectedEventId(null); }
                            else {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              const clickX = e.clientX - rect.left;
                              const evStart = new Date(ev.start_time).getTime();
                              const evEnd = new Date(ev.end_time).getTime();
                              const t = new Date(evStart + (clickX / rect.width) * (evEnd - evStart));
                              useStore.getState().setViewTime(t);
                              useStore.getState().setSelectedEventId(ev.id);
                            }
                          }}
                          style={{
                            position: 'absolute', left: x, top: 2, width: w,
                            height: rowHeight - 4, background: color, borderRadius: 2,
                            opacity: isSel ? 1 : 0.7, border: isSel ? '1px solid #fff' : '1px dashed rgba(255,255,255,0.6)',
                            cursor: 'grab', zIndex: isSel ? 7 : 4,
                          }}
                        />
                      );
                    }

                    return (
                      <div key={i} onPointerDown={(e) => {
                        e.stopPropagation();
                        const cur = useStore.getState().selectedEventId;
                        if (cur === ev.id) { useStore.getState().setSelectedEventId(null); }
                        else {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const clickX = e.clientX - rect.left;
                          const evStart = new Date(ev.start_time).getTime();
                          const evEnd = new Date(ev.end_time).getTime();
                          const t = new Date(evStart + (clickX / rect.width) * (evEnd - evStart));
                          useStore.getState().setViewTime(t);
                          useStore.getState().setSelectedEventId(ev.id);
                        }
                      }} style={{
                        position: 'absolute', left: x, top: 2, width: w,
                        height: rowHeight - 4, background: color, borderRadius: 2,
                        opacity: isSel ? 1 : 0.8,
                        border: isSel ? '1px solid #fff' : '1px solid rgba(0,0,0,0.2)',
                        cursor: 'pointer', zIndex: isSel ? 7 : 3,
                      }} />
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div style={{ position: 'absolute', left: playheadX, top: 0, bottom: 0, width: 2, background: 'var(--accent)', zIndex: 6 }} onMouseEnter={() => setHoveringPlayhead(true)} onMouseLeave={() => setHoveringPlayhead(false)}>
            <div style={{ position: 'absolute', top: 0, left: -5, width: 12, height: 12, background: 'var(--accent)', clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
