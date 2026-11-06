# Spike regression checks

Run from the workspace root:

```sh
pnpm --filter @workspace/spike test
pnpm --filter @workspace/spike run typecheck
```

## Meal history and demo controls

`spike.test.ts` and `demo-controls.test.tsx` use isolated personal and demo
histories, real storage helpers and real demo controls. They cover loading and
resetting demo meals, edits and deletes in each store, saving a personal meal
while demo is active, and restoring personal history byte-for-byte after clear.
Controls synchronize across placements and storage events and remove listeners
on unmount. Failed writes, failed clear operations, unreadable mode storage,
corrupt history and failed save verification must not silently select or
overwrite another history; controls surface actionable errors and allow retry.

The shared setup mocks the API analytics relay before import and blocks fetch
and XHR. Analytics assertions check demo suppression and personal emission
without contacting the relay or Mixpanel. No browser or external service is
needed for these regressions.

## Walk routing checks

`walk-suggestion.test.tsx` renders **real Leaflet** in jsdom and exercises the
real `findWalk` with mocked HTTP responses. It covers denied, unsupported,
timed-out and unavailable geolocation, the Union Square example, a stalled
Overpass lookup at its four-second boundary, routing failure, and a verified
park route with its actual distance. Assertions check visible OSM attribution,
schematic wording and dotted/solid paths, real Home progress writes and
allowlisted analytics without user/park coordinates, and SPA navigation
cleanup (map removal, canceled resize, aborted lookup/routing, clean remount,
and an ignored late response).

`walk-route.test.ts` checks the four-second lookup boundary, routing
network/HTTP/no-route/invalid-geometry/distant-snap/timeout failures, park
success, longer-loop notices, bounded park selection and cancellation in both
network stages. Fetch is restricted to deterministic Overpass/router fixtures;
no real map service, analytics relay or AI request is made. Native abort
deadlines are connected to fake timers so these tests do not sleep.

## Chromium checks

Start the existing `artifacts/spike: web` managed workflow, then run:

```sh
pnpm --filter @workspace/spike exec playwright install chromium
pnpm --filter @workspace/spike test:browser
```

`e2e/walk-map.spec.ts` repeats the key location/network cases at a mobile
viewport in real Chromium. It uses the running **Vite development server**
(including its module endpoint for the product's seed generator), not a
production build. Its default URL is the artifact proxy at `http://localhost:80`;
set `WALK_TEST_BASE_URL` to a development preview URL when running remotely.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a preinstalled Chromium.
In this workspace the verified browser command is:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/repl/tools/bin/chromium pnpm --filter @workspace/spike test:browser
```

Each case gets an isolated browser context. API analytics are captured without
forwarding, tiles are local placeholders, and Overpass/router responses are
mocked. The slow Overpass case holds the response until after the app's real
four-second timeout. The park case starts/completes a walk, checks storage and
analytics privacy, navigates to Week and checks the detached map was cleaned up.
Traces and failure screenshots stay in ignored `generated-artifacts/walk-browser`.
The browser timeout error is injected; the requested five-second geolocation
option is asserted separately in the component tests. These checks do not
exercise a real OS permission dialog, GPS hardware or remote service availability.

## Existing timer checks

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
- Removing the selected walk suggestion (separate from Undo), while running or
  completed, clears timer metadata and completion without changing other meals.
  Week counts update immediately; remounting cannot revive the removed timer,
  and reselecting starts a fresh ten-minute walk.
- Removing food-order or swap suggestions preserves running and completed walk
  progress across remounts. Failed walk-removal writes preserve storage, selected
  state, timer/completion and Week counts, emit no change event and allow retry.
- Demo interactions suppress analytics.

The clock is fixed and advanced without real waiting. Reload is modeled by
unmounting the pages and mounting fresh instances over the same storage;
backgrounding is modeled by jumping the wall clock without running intervals,
then dispatching `visibilitychange`. These are component integration checks,
not physical phone-lock or full browser navigation tests.

In these timer-only checks, charts/audio and Leaflet rendering are stubbed; geolocation and route refinement
use deterministic local fixtures. Storage, Home callbacks, Week statistics and
the analytics allowlist remain real. A few tests copy a demo-generated meal into
the isolated non-demo store so analytics assertions are not vacuous.
The generated API client is replaced before import, so `trackSpikeEvent` is
only an in-memory spy and cannot call the API relay or Mixpanel. Fetch and XHR
are blocked as an additional safeguard. No user history, server or secrets are
needed; test state, clocks and mocks are reset after each test.
