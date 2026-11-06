import { useEffect, useRef, useState } from 'react';
import { Check, Play, Timer } from 'lucide-react';
import { track, type MealLog } from '@/lib/spike';

const MS = 10 * 60 * 1000;
type RoutineType = 'home' | 'desk' | 'gentle';

const ROUTINES: Record<RoutineType, { title: string; items: string[]; note?: string }> = {
  home: { title: '10-min home routine', items: ['Bodyweight squats', 'Wall push-ups', 'Marching in place', 'Calf raises'] },
  desk: { title: '10-min desk routine', items: ['Seated leg lifts', 'Stair climbing if available', 'Standing calf raises'], note: 'Only take the stairs if they are available and comfortable.' },
  gentle: { title: 'Gentle seated option', items: ['Seated marching', 'Arm circles', 'Gentle yoga stretches'], note: 'Choose what feels comfortable.' },
};

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function MovementRoutine({
  log,
  type,
  onStart,
  onComplete,
  onUndo,
}: {
  log: MealLog;
  type: RoutineType;
  onStart: (at: number) => boolean;
  onComplete: (minutes: number) => boolean;
  onUndo: () => boolean;
}) {
  const r = ROUTINES[type];
  const startedAt = log.movementStartedAt;
  const done = !!log.movementCompleted;
  const running = typeof startedAt === 'number' && !done;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const remaining = running ? startedAt + MS - now : MS;

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

  const guard = (fn: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { fn(); } finally { busyRef.current = false; setBusy(false); }
  };

  const start = () => guard(() => {
    if (running || done) return;
    const at = Date.now();
    if (onStart(at) && !log.demo) track({ event: 'movement_started', type });
    setNow(at);
  });
  const finish = () => guard(() => {
    if (done || typeof startedAt !== 'number') return;
    const minutes = Math.max(0, Math.round((Date.now() - startedAt) / 6000) / 10);
    if (onComplete(minutes) && !log.demo) track({ event: 'movement_completed', type });
  });

  return (
    <div className="mt-3 rounded-3xl border border-dashed border-input p-4 rise" data-testid={`card-movement-${type}`}>
      <div className="flex items-start gap-3">
        <span className="rounded-xl p-2 bg-secondary text-secondary-foreground"><Timer className="w-5 h-5" /></span>
        <div className="flex-1">
          <p className="font-display text-lg leading-tight">{done ? 'Movement done. Nice work.' : r.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-movement-status">
            {done ? `${log.movementMinutes ?? 10} min logged` : running ? (remaining > 0 ? 'Timer keeps going even if you lock your phone.' : 'Ten minutes up. Tap Done when you finish.') : 'Mix these at an easy pace for about ten minutes.'}
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5" data-testid="list-movement">
        {r.items.map((it) => (
          <li key={it} className="flex items-center gap-2 text-sm"><span className="w-1.5 h-1.5 rounded-full bg-primary" />{it}</li>
        ))}
      </ul>
      {r.note && <p className="mt-2 text-sm font-medium" data-testid="text-movement-note">{r.note}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">Stop if anything hurts or you feel unwell.</p>
      {running && (
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-foreground text-background px-5 py-4">
          <span className="font-mono text-3xl tabular-nums" data-testid="text-movement-timer" aria-live="off">{remaining > 0 ? fmt(remaining) : '0:00'}</span>
          <button data-testid="button-movement-done" disabled={busy} onClick={finish} className="rounded-full bg-accent text-accent-foreground px-5 py-2.5 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
            <Check className="w-4 h-4" /> Done
          </button>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {!running && !done && (
          <button data-testid="button-movement-start" disabled={busy} onClick={start} className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
            <Play className="w-4 h-4" /> Start 10-min timer
          </button>
        )}
        {done && (
          <button data-testid="button-movement-undo" disabled={busy} onClick={() => guard(() => { onUndo(); })} className="rounded-full bg-secondary text-secondary-foreground px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
