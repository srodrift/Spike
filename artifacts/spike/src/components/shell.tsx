import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { DemoControls, useDemoLoaded } from './demo-controls';

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const demo = useDemoLoaded();
  const [details, setDetails] = useState(false);
  const tab = (href: string, label: string, id: string) => {
    const active = href === '/' ? loc === '/' : loc.startsWith(href);
    return (
      <Link
        href={href}
        data-testid={`link-${id}`}
        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
          active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {label}
        {id === 'week' && demo && <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] text-secondary-foreground" data-testid="badge-demo">Demo data</span>}
      </Link>
    );
  };
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/60">
        <div className="mx-auto max-w-xl px-5 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" data-testid="link-logo">
            <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden>
              <path d="M1 16 C7 16 8 2 13 2 C18 2 19 16 25 16" fill="none" stroke="hsl(12 82% 56%)" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span className="font-display text-xl font-semibold tracking-tight">Spike</span>
          </Link>
          <nav className="flex gap-1 rounded-full bg-muted p-1">
            {tab('/', 'Plate', 'plate')}
            {tab('/week', 'Week', 'week')}
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-xl px-5 pt-6 pb-10">{children}</main>
      <footer className="mx-auto max-w-xl w-full px-5 pb-8 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground/80 flex items-center gap-2" data-testid="text-disclaimer">
          <span>Education only, not medical advice.</span>
          <button
            type="button"
            data-testid="button-disclaimer-details"
            aria-expanded={details}
            aria-controls="disclaimer-details"
            onClick={() => setDetails((d) => !d)}
            className="shrink-0 underline underline-offset-2 text-primary"
          >
            {details ? 'Hide' : 'Details'}
          </button>
        </p>
        {details && (
          <div id="disclaimer-details" className="space-y-2 rise" data-testid="text-disclaimer-details">
            <p>General wellness education, not medical advice. Not for insulin or medication decisions.</p>
            <p>
              Estimates are rough: portion sizes are guessed and individual responses vary widely. Meal analysis is sent to an AI
              service; your logs stay on this device; usage analytics are anonymous.
            </p>
          </div>
        )}
        <p>
          <Link href="/?movement=settings" data-testid="link-movement-settings" className="underline underline-offset-2">
            Movement settings
          </Link>
        </p>
        <DemoControls placement="footer" />
      </footer>
    </div>
  );
}
