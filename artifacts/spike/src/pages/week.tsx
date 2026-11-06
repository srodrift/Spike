import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowRight, Footprints, Flame, UtensilsCrossed, TrendingUp } from 'lucide-react';
import { loadLogs, localDateKey, track, LEVEL_STYLE, LOGS_CHANGED, type MealLog } from '@/lib/spike';
import { DemoControls, useDemoLoaded } from '@/components/demo-controls';

export default function Week() {
  const [logs, setLogs] = useState<MealLog[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sent = useRef(false);
  const demo = useDemoLoaded();

  const read = () => {
    try {
      setLogs(loadLogs());
      setErr(null);
    } catch {
      setErr('We could not read your meal history from this device. Storage may be blocked or corrupted.');
      setLogs([]);
    }
  };

  useEffect(() => {
    document.title = 'Your week — Spike';
    read();
    window.addEventListener(LOGS_CHANGED, read);
    window.addEventListener('storage', read);
    if (!sent.current) {
      sent.current = true;
      track({ event: 'weekly_view_opened' });
    }
    return () => {
      window.removeEventListener(LOGS_CHANGED, read);
      window.removeEventListener('storage', read);
    };
  }, []);

  const stats = useMemo(() => {
    const all = logs ?? [];
    const days: { key: string; label: string; meals: MealLog[] }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      days.push({ key, label: d.toLocaleDateString([], { weekday: 'narrow' }), meals: all.filter((l) => localDateKey(new Date(l.date)) === key) });
    }
    const inWeek = days.flatMap((d) => d.meals);
    const keys = new Set(all.map((l) => localDateKey(new Date(l.date))));
    let streak = 0;
    const c = new Date();
    if (!keys.has(localDateKey(c))) c.setDate(c.getDate() - 1);
    while (keys.has(localDateKey(c))) {
      streak++;
      c.setDate(c.getDate() - 1);
    }
    return {
      days,
      inWeek: [...inWeek].sort((a, b) => b.date.localeCompare(a.date)),
      high: inWeek.filter((l) => l.estimate.glycemic_level === 'High').length,
      walks: inWeek.filter((l) => l.walkCompleted).length,
      streak: demo ? 5 : streak,
    };
  }, [logs, demo]);

  if (!logs)
    return (
      <div className="space-y-3">
        <div className="h-10 w-2/3 rounded-xl bg-muted animate-pulse" />
        <div className="h-40 rounded-3xl bg-muted animate-pulse" />
      </div>
    );

  const max = Math.max(1, ...stats.days.map((d) => d.meals.length));
  const tiles = [
    { k: 'meals', label: 'Meals logged', v: stats.inWeek.length, icon: UtensilsCrossed },
    { k: 'high', label: 'High-spike meals', v: stats.high, icon: TrendingUp },
    { k: 'walks', label: 'Walks completed', v: stats.walks, icon: Footprints },
    { k: 'streak', label: 'Day streak', v: stats.streak, icon: Flame },
  ];

  return (
    <section className="rise">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Last 7 days &middot; this device only</p>
      <h1 className="font-display text-[2.4rem] leading-tight mt-2">Your week</h1>
      {demo && (
        <div className="mt-2 text-xs text-muted-foreground">
          <p>Demo data · 14 sample meals, 4 illustrative reductions. The 5-day streak is simulated, not calculated from these 7 days.</p>
          <DemoControls placement="week" />
        </div>
      )}

      {err && (
        <div className="mt-4 rounded-2xl bg-destructive/10 text-destructive p-3 text-sm flex gap-2 items-start" data-testid="text-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{err}</span>
          <button onClick={read} className="underline font-semibold" data-testid="button-retry">Retry</button>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        {tiles.map(({ k, label, v, icon: Icon }, i) => (
          <div key={k} className={`rounded-2xl p-4 rise ${i === 0 ? 'bg-foreground text-background' : 'bg-card border border-card-border'}`} style={{ animationDelay: `${i * 60}ms` }}>
            <Icon className={`w-5 h-5 ${i === 0 ? 'text-accent' : 'text-primary'}`} />
            <div className="font-display text-4xl mt-3" data-testid={`text-stat-${k}`}>{v}</div>
            <div className="text-xs opacity-70">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-3xl bg-card border border-card-border p-4">
        <div className="flex items-end justify-between gap-2 h-28">
          {stats.days.map((d, i) => (
            <div key={d.key} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <div
                className="w-full rounded-lg overflow-hidden origin-bottom rise flex flex-col-reverse bg-muted"
                style={{ height: `${d.meals.length ? (d.meals.length / max) * 80 + 10 : 6}%`, animationDelay: `${i * 40}ms` }}
                data-testid={`bar-day-${i}`}
                role="img"
                aria-label={`${d.key}: ${d.meals.length} meals. ${d.meals.map((m) => m.estimate.glycemic_level).join(', ')}`}
              >
                {(['Low', 'Medium', 'High'] as const).map((level) => {
                  const count = d.meals.filter((m) => m.estimate.glycemic_level === level).length;
                  return count > 0 ? <div key={level} title={`${count} ${level} meal${count > 1 ? 's' : ''}`} style={{ flex: count, background: LEVEL_STYLE[level].color }} /> : null;
                })}
              </div>
              <span className={`text-[11px] font-mono ${i === 6 ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>{d.label}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-4 justify-center text-[10px] text-muted-foreground" aria-label="Spike levels">
          {(['Low', 'Medium', 'High'] as const).map((level) => <span key={level} className="inline-flex gap-1 items-center"><i className="w-2 h-2 rounded-full" style={{ background: LEVEL_STYLE[level].color }} />{level}</span>)}
        </div>
      </div>

      {stats.inWeek.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-input p-8 text-center" data-testid="status-empty">
          <svg width="80" height="40" viewBox="0 0 80 40" className="mx-auto" aria-hidden>
            <path d="M2 36 C20 36 26 8 40 8 C54 8 60 36 78 36" fill="none" stroke="hsl(32 25% 78%)" strokeWidth="3" strokeDasharray="5 6" strokeLinecap="round" />
          </svg>
          <p className="font-display text-xl mt-3">A quiet week so far</p>
          <p className="text-sm text-muted-foreground mt-1">Read a plate and it will land here, saved only on this device.</p>
          <Link href="/" className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-3 font-semibold" data-testid="link-first-meal">
            Read a plate <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {stats.inWeek.map((l) => {
            const s = LEVEL_STYLE[l.estimate.glycemic_level];
            return (
              <li key={l.id}>
                <Link href={`/?log=${l.id}`} className="flex items-center gap-3 rounded-2xl bg-card border border-card-border p-4 hover:border-foreground/40 transition-colors" data-testid={`link-log-${l.id}`}>
                  <span className="w-2.5 h-10 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{l.estimate.name}</span>
                    <span className="block text-xs text-muted-foreground font-mono">
                      {new Date(l.date).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} &middot; {l.estimate.glycemic_level}
                      {l.appliedFixes.length > 0 && ` \u00b7 ${l.appliedFixes.length} suggestion${l.appliedFixes.length > 1 ? 's' : ''}`}
                      {l.walkCompleted && ' \u00b7 walked'}
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {stats.inWeek.length === 0 && <div className="text-center mt-3"><DemoControls placement="empty" /></div>}
    </section>
  );
}
