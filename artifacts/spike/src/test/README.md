# Walk regression checks

Run from the workspace root:

```sh
pnpm --filter @workspace/spike test
pnpm --filter @workspace/spike run typecheck
```

`home.walk.test.tsx` renders the real Home, WalkSuggestion and Week together,
using the application's demo-week generator and jsdom localStorage. Tests cover:

- Starting persists a timestamp; a fresh Home mount restores the elapsed timer.
- Visibility changes catch up after suspended interval ticks.
- Zero stays at zero until Done is explicitly pressed, including after remount.
- Done saves once, records actual elapsed minutes, updates Week immediately and
  survives remount.
- Failed Start, Done and Undo writes leave saved state and counts unchanged;
  failed Done does not emit `walk_completed`, and a retry can succeed.
- Undo clears all timer metadata and a new walk starts at ten minutes.
- Demo interactions suppress analytics.

The clock is fixed and advanced without real waiting. Reload is modeled by
unmounting the pages and mounting fresh instances over the same storage;
backgrounding is modeled by jumping the wall clock without running intervals,
then dispatching `visibilitychange`. These are component integration checks,
not physical phone-lock or full browser navigation tests.

Charts/audio and Leaflet rendering are stubbed; geolocation and route refinement
use deterministic local fixtures. Storage, Home callbacks, Week statistics and
the analytics allowlist remain real. A few tests copy a demo-generated meal into
the isolated non-demo store so analytics assertions are not vacuous.
The generated API client is replaced before import, so `trackSpikeEvent` is
only an in-memory spy and cannot call the API relay or Mixpanel. Fetch and XHR
are blocked as an additional safeguard. No user history, server or secrets are
needed; test state, clocks and mocks are reset after each test.
