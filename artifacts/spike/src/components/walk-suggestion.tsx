import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Footprints, Check, Loader2, AlertCircle, Play } from 'lucide-react';
import { track, type MealLog } from '@/lib/spike';
import { defaultWalk, findWalk, FALLBACK_LOCATION, type LatLng, type WalkPlan } from '@/lib/walk-route';

const WALK_MS = 10 * 60 * 1000;

type Source = 'user' | 'fallback';

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function WalkSuggestion({
  log,
  onStart,
  onComplete,
  onUndo,
}: {
  log: MealLog;
  onStart: (startedAt: number, viaPark: boolean) => boolean;
  onComplete: (minutes: number, viaPark: boolean) => boolean;
  onUndo: () => boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'locating' | 'shown'>('idle');
  const [plan, setPlan] = useState<WalkPlan | null>(null);
  const [source, setSource] = useState<Source>('user');
  const [refining, setRefining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mapEl = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);

  const startedAt = log.walkStartedAt;
  const running = typeof startedAt === 'number' && !log.walkCompleted;
  const frozen = useRef(false);
  frozen.current = typeof startedAt === 'number';
  const remaining = running ? startedAt + WALK_MS - now : WALK_MS;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Reset on meal change
  useEffect(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setPlan(null);
    setNotice(null);
    setRefining(false);
  }, [log.id]);

  // Wall-clock ticker
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [running]);

  // Leaflet map
  useEffect(() => {
    if (!plan || !mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.polyline(plan.path, {
      color: 'hsl(12 82% 56%)',
      weight: 4,
      opacity: 0.85,
      dashArray: plan.routed ? undefined : '2 8',
      lineCap: 'round',
    }).addTo(map);
    const startLabel = document.createElement('span');
    startLabel.textContent = source === 'user' ? 'You are here (approx.)' : 'Example start: Union Square, SF';
    L.circleMarker(plan.start, { radius: 8, color: 'hsl(292 28% 17%)', weight: 3, fillColor: 'hsl(46 92% 66%)', fillOpacity: 1 })
      .bindTooltip(startLabel, { direction: 'top', offset: [0, -6] })
      .addTo(map);
    plan.waypoints.slice(0, 4).forEach((wp, i) => {
      const el = document.createElement('div');
      el.textContent = String(i + 1);
      el.style.cssText =
        'width:22px;height:22px;border-radius:999px;background:hsl(170 40% 36%);color:hsl(40 60% 98%);font:600 11px "Spline Sans Mono",monospace;display:flex;align-items:center;justify-content:center;border:2px solid hsl(40 60% 98%);';
      const m = L.marker(wp, { icon: L.divIcon({ html: el, className: '', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
      if (plan.viaPark && plan.parkName && i === 1) {
        const tip = document.createElement('span');
        tip.textContent = plan.parkName;
        m.bindTooltip(tip, { direction: 'top', offset: [0, -10] });
      }
    });
    const bounds = L.latLngBounds([plan.start, ...plan.path, ...plan.waypoints] as LatLng[]);
    map.fitBounds(bounds, { padding: [24, 24] });
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => {
      clearTimeout(t);
      map.remove();
    };
  }, [plan, source]);

  const showPlan = (start: LatLng, src: Source) => {
    if (!alive.current) return;
    setSource(src);
    setPlan(defaultWalk(start));
    setPhase('shown');
    if (!log.demo) track({ event: 'walk_map_opened' });
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (frozen.current) {
      setRefining(false);
      return;
    }
    setRefining(true);
    findWalk(start, ctrl.signal)
      .then((p) => {
        if (!ctrl.signal.aborted && alive.current && !frozen.current) setPlan(p);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!ctrl.signal.aborted && alive.current) setRefining(false);
      });
  };

  const findMyWalk = () => {
    setNotice(null);
    if (!('geolocation' in navigator)) {
      setNotice('Location is not available in this browser, so here is an example loop from Union Square, San Francisco.');
      showPlan(FALLBACK_LOCATION, 'fallback');
      return;
    }
    setPhase('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => showPlan([pos.coords.latitude, pos.coords.longitude], 'user'),
      (err) => {
        if (!alive.current) return;
        if (err.code === 1) {
          if (!log.demo) track({ event: 'location_denied' });
          setNotice('Location permission was denied. Showing an example loop from Union Square, San Francisco instead.');
        } else if (err.code === 3) {
          setNotice('Finding your location took too long. Showing an example loop from Union Square, San Francisco instead.');
        } else {
          setNotice('We could not get your location. Showing an example loop from Union Square, San Francisco instead.');
        }
        showPlan(FALLBACK_LOCATION, 'fallback');
      },
      { timeout: 5000, maximumAge: 60000, enableHighAccuracy: false },
    );
  };

  const start = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const at = Date.now();
    const viaPark = !!plan?.viaPark;
    frozen.current = true;
    abortRef.current?.abort();
    setRefining(false);
    const saved = onStart(at, viaPark);
    if (saved && !log.demo) {
      track({ event: 'walk_started', minutes: 10, via_park: viaPark });
      track({ event: 'movement_started', type: 'walk' });
    }
    if (!saved) frozen.current = false;
    setNow(at);
    busyRef.current = false;
    setBusy(false);
  };

  const done = () => {
    if (busyRef.current || log.walkCompleted) return;
    busyRef.current = true;
    setBusy(true);
    const minutes = typeof startedAt === 'number' ? Math.max(0, Math.round((Date.now() - startedAt) / 6000) / 10) : 0;
    const viaPark = !!log.walkViaPark;
    if (onComplete(minutes, viaPark) && !log.demo) {
      track({ event: 'walk_completed', minutes, via_park: viaPark });
      track({ event: 'movement_completed', type: 'walk' });
    }
    busyRef.current = false;
    setBusy(false);
  };

  const undo = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    onUndo();
    busyRef.current = false;
    setBusy(false);
  };

  const km = plan ? plan.distanceMeters / 1000 : 0;
  const estMin = plan ? Math.max(1, Math.round((km / 5) * 60)) : 0;

  return (
    <div className="mt-3 rounded-3xl border border-dashed border-input p-4 rise" data-testid="card-walk">
      <div className="flex items-start gap-3">
        <span className="rounded-xl p-2 bg-secondary text-secondary-foreground"><Footprints className="w-5 h-5" /></span>
        <div className="flex-1">
          <p className="font-display text-lg leading-tight">
            {log.walkCompleted ? 'Walk done. Nice work.' : running ? 'Walking now' : 'A short loop after eating'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-walk-status">
            {log.walkCompleted
              ? `${log.walkMinutes ?? 10} min logged${log.walkViaPark ? ' · via a park' : ''}`
              : running
                ? remaining > 0 ? 'Timer keeps going even if you lock your phone.' : 'Ten minutes up. Tap Done once you are back.'
                : 'Ten easy minutes is plenty. Mark it once you have actually walked.'}
          </p>
        </div>
      </div>

      {running && (
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-foreground text-background px-5 py-4">
          <span className="font-mono text-3xl tabular-nums" data-testid="text-walk-timer">{remaining > 0 ? fmt(remaining) : '0:00'}</span>
          <button
            data-testid="button-walk-done"
            disabled={busy}
            onClick={done}
            className="rounded-full bg-accent text-accent-foreground px-5 py-2.5 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 active:scale-[0.97] transition-transform"
          >
            <Check className="w-4 h-4" /> Done
          </button>
        </div>
      )}

      {phase === 'shown' && plan && (
        <div className="mt-4">
          <div className="relative z-0 isolate h-60 w-full overflow-hidden rounded-2xl border border-card-border bg-muted" data-testid="map-walk">
            <div ref={mapEl} className="absolute inset-0" />
            {refining && (
              <span className="absolute top-2 right-2 z-[500] rounded-full bg-card/95 px-2.5 py-1 text-[11px] font-mono flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Finding paths
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="flex items-center gap-1 font-medium" data-testid="text-walk-source">
              <MapPin className="w-3.5 h-3.5" /> {source === 'user' ? 'Starting from your location' : 'Example start: Union Square, SF'}
            </span>
            <span className="font-mono text-muted-foreground" data-testid="text-walk-distance">
              ~{km.toFixed(km < 1 ? 2 : 1)} km &middot; ~{estMin} min at 5 km/h
            </span>
          </div>
          {plan.viaPark && plan.parkName && (
            <p className="mt-1 text-sm font-semibold text-secondary-foreground" data-testid="text-walk-park">Walk via {plan.parkName}</p>
          )}
          {plan.note && <p className="mt-1 text-xs text-muted-foreground">{plan.note}</p>}
          {!plan.routed && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="text-walk-sketch">
              Dotted line is a schematic sketch, not verified walking directions. Check paths and crossings as you go.
            </p>
          )}
        </div>
      )}

      {notice && (
        <p className="mt-3 text-xs text-muted-foreground flex gap-2" data-testid="text-walk-notice">
          <AlertCircle className="w-4 h-4 shrink-0" /> {notice}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {phase !== 'shown' && (
          <button
            data-testid="button-find-walk"
            disabled={phase === 'locating'}
            onClick={findMyWalk}
            className="rounded-full border border-input px-4 py-2.5 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60"
          >
            {phase === 'locating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            {phase === 'locating' ? 'Locating\u2026' : 'Find my walk'}
          </button>
        )}
        {phase === 'shown' && !running && !log.walkCompleted && (
          <button
            data-testid="button-walk-start"
            disabled={busy}
            onClick={start}
            className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 active:scale-[0.97] transition-transform"
          >
            <Play className="w-4 h-4" /> Start walk
          </button>
        )}
        {log.walkCompleted && (
          <button
            data-testid="button-walk-undo"
            disabled={busy}
            onClick={undo}
            className="rounded-full bg-secondary text-secondary-foreground px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            Undo
          </button>
        )}
      </div>
      {phase === 'idle' && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Find my walk asks for your location once. It is sent to OpenStreetMap, Overpass and a routing service to draw the loop, and is never saved.
        </p>
      )}
    </div>
  );
}
