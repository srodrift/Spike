import { useEffect, useState } from 'react';
import { clearDemoData, demoLoaded, loadDemoWeek, LOGS_CHANGED } from '@/lib/spike';

export function useDemoLoaded() {
  const [demo, setDemo] = useState(demoLoaded);
  useEffect(() => {
    const refresh = () => setDemo(demoLoaded());
    window.addEventListener(LOGS_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(LOGS_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return demo;
}

export function DemoControls({ placement }: { placement: string }) {
  const demo = useDemoLoaded();
  const [error, setError] = useState('');
  const change = (action: () => void) => {
    try { action(); setError(''); }
    catch { setError('Demo data could not be changed. Device storage may be full or blocked.'); }
  };
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        className="underline underline-offset-4 hover:text-foreground py-2"
        data-testid={`button-load-demo-${placement}`}
        onClick={() => change(loadDemoWeek)}
      >Load demo week</button>
      {demo && (
        <button
          type="button"
          className="underline underline-offset-4 hover:text-foreground py-2 ml-4"
          data-testid={`button-clear-demo-${placement}`}
          onClick={() => change(clearDemoData)}
        >Clear demo data</button>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  );
}
