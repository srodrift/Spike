import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { trackSpikeEvent } from '@workspace/api-client-react';
import { WalkSuggestion } from './walk-suggestion';
import Home from '@/pages/home';
import { seedWalk } from '@/test/walk-fixtures';
import { loadLogs } from '@/lib/spike';
import {
  jsonResponse, mockAbortTimeouts, mockWalkNetwork, OVERPASS, PARK_LOCATION, PARK_NAME,
  parkResponse, ROUTING, routeResponse, untilAborted, USER_LOCATION,
} from '@/test/walk-network';

// Keep Leaflet, route discovery, analytics allowlist and Home persistence real.
vi.mock('@/components/curve-chart', () => ({ CurveChart: () => null }));
vi.mock('@/components/hear-summary', () => ({ HearSummary: () => null }));

const originalSvg = Object.getOwnPropertyDescriptor(L.Browser, 'svg')!;
beforeEach(() => {
  vi.useFakeTimers();
  mockAbortTimeouts();
  // jsdom lacks createSVGRect; Leaflet's actual SVG renderer otherwise works.
  Object.defineProperty(L.Browser, 'svg', { ...originalSvg, value: true });
});
afterEach(() => { Object.defineProperty(L.Browser, 'svg', originalSvg); });

function deferredLocation() {
  const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>();
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    geolocation: { getCurrentPosition },
  }));
  return getCurrentPosition;
}

function locationResult(code?: number) {
  return deferredLocation().mockImplementation((success, error) => {
    if (code) error?.({ code, message: 'Fixture failure' } as GeolocationPositionError);
    else success({ coords: {
      latitude: USER_LOCATION[0], longitude: USER_LOCATION[1],
    } } as GeolocationPosition);
  });
}

function openCard() {
  const callbacks = { onStart: vi.fn(() => true), onComplete: vi.fn(() => true), onUndo: vi.fn(() => true) };
  return { ...render(<WalkSuggestion log={seedWalk({ demo: false })} {...callbacks} />), ...callbacks };
}

function openSavedWalk() {
  const log = seedWalk({ demo: false });
  const location = memoryLocation({ path: `/?log=${encodeURIComponent(log.id)}` });
  render(<Router hook={location.hook}><Home /></Router>);
  return log;
}

async function find() {
  await act(async () => { fireEvent.click(screen.getByTestId('button-find-walk')); });
}

function attribution() {
  const link = within(screen.getByTestId('map-walk')).getByRole('link', { name: 'OpenStreetMap' });
  expect(link).toBeVisible();
  expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
}

describe('walk map location fallbacks and refinement', () => {
  it.each([
    [1, 'Location permission was denied.'],
    [3, 'Finding your location took too long.'],
    [2, 'We could not get your location.'],
  ])('shows a usable Union Square example on location error %s', async (code, notice) => {
    const geolocation = locationResult(code);
    const network = mockWalkNetwork({ routing: () => jsonResponse({}, 503) });
    openCard();
    await find();
    expect(geolocation.mock.calls[0]![2]).toEqual({
      timeout: 5000, maximumAge: 60000, enableHighAccuracy: false,
    });
    expect(screen.getByTestId('text-walk-notice')).toHaveTextContent(notice);
    expect(screen.getByTestId('text-walk-source')).toHaveTextContent('Example start: Union Square, SF');
    expect(screen.getByTestId('text-walk-sketch')).toHaveTextContent('not verified walking directions');
    expect(screen.queryByTestId('text-walk-park')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-walk-start')).toBeEnabled();
    expect(String(network.mock.calls[0]![1]!.body)).toContain('37.7879');
    attribution();
    const emitted = vi.mocked(trackSpikeEvent).mock.calls.map(([payload]) => payload);
    expect(emitted.filter(({ event }) => event === 'location_denied')).toHaveLength(code === 1 ? 1 : 0);
    expect(emitted.filter(({ event }) => event === 'walk_map_opened')).toHaveLength(1);
  });

  it('does not attempt geolocation when the browser does not support it', async () => {
    // A fresh object without navigator's prototype is necessary: `in` checks it.
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent });
    mockWalkNetwork({ routing: () => jsonResponse({}, 503) });
    openCard();
    await find();
    expect(screen.getByTestId('text-walk-notice')).toHaveTextContent('Location is not available in this browser');
    expect(screen.getByTestId('text-walk-source')).toHaveTextContent('Example start: Union Square, SF');
    expect(screen.getByTestId('text-walk-sketch')).toBeVisible();
    attribution();
  });

  it('keeps a sketch usable during a slow Overpass request and refines after its four-second deadline', async () => {
    locationResult();
    const network = mockWalkNetwork({ overpass: untilAborted });
    openCard();
    await find();
    expect(screen.getByText('Finding paths')).toBeVisible();
    expect(screen.getByTestId('text-walk-source')).toHaveTextContent('Starting from your location');
    expect(screen.getByTestId('text-walk-sketch')).toBeVisible();
    expect(screen.getByTestId('button-walk-start')).toBeEnabled();
    attribution();
    await act(async () => { await vi.advanceTimersByTimeAsync(3999); });
    expect(network).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(network.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(network).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Finding paths')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-walk-sketch')).not.toBeInTheDocument();
    expect(screen.getByText(/Suggested pedestrian route/)).toBeVisible();
    attribution();
  });

  it('never advertises an unverified park when routing fails', async () => {
    locationResult();
    mockWalkNetwork({ overpass: parkResponse, routing: () => { throw new TypeError('Offline'); } });
    const { onStart } = openCard();
    await find();
    expect(screen.queryByText('Finding paths')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-walk-park')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-walk-sketch')).toHaveTextContent('schematic sketch');
    expect(screen.getByText(/Walking directions unavailable/)).toBeVisible();
    expect(screen.getByTestId('text-walk-distance')).toHaveTextContent('~0.80 km');
    expect(document.querySelector('.leaflet-overlay-pane path')).toHaveAttribute('stroke-dasharray', '2 8');
    attribution();
    fireEvent.click(screen.getByTestId('button-walk-start'));
    expect(onStart).toHaveBeenCalledWith(expect.any(Number), false);
  });

  it('shows the routed park and real distance, with a solid path and no schematic claim', async () => {
    locationResult();
    mockWalkNetwork({ overpass: parkResponse, routing: (url) => routeResponse(url, 1450) });
    const { onStart } = openCard();
    await find();
    expect(screen.getByTestId('text-walk-park')).toHaveTextContent(`Walk via ${PARK_NAME}`);
    expect(screen.getByTestId('text-walk-distance')).toHaveTextContent('~1.4 km · ~17 min');
    expect(screen.getByText(/This loop is longer than 10 minutes/)).toBeVisible();
    expect(screen.queryByTestId('text-walk-sketch')).not.toBeInTheDocument();
    expect(document.querySelector('.leaflet-overlay-pane path')).not.toHaveAttribute('stroke-dasharray');
    attribution();
    fireEvent.click(screen.getByTestId('button-walk-start'));
    expect(onStart).toHaveBeenCalledWith(expect.any(Number), true);
  });
});

describe.each(['overpass', 'routing'] as const)('starting while %s is pending', (stage) => {
  it.each(['honors abort', 'returns late success'] as const)(
    'aborts refinement and freezes the displayed and saved plan when the request %s', async (behavior) => {
      locationResult();
      let resolve!: (response: Response) => void;
      // The late-success variant deliberately never listens to the AbortSignal.
      const pending = behavior === 'honors abort'
        ? untilAborted
        : () => new Promise<Response>((done) => { resolve = done; });
      const network = mockWalkNetwork({
        overpass: stage === 'overpass' ? pending : parkResponse,
        routing: stage === 'routing' ? pending : (url) => routeResponse(url, 1450),
      });
      const log = openSavedWalk();
      await find();
      expect(network).toHaveBeenCalledTimes(stage === 'overpass' ? 1 : 2);
      expect(screen.getByText('Finding paths')).toBeVisible();
      const [pendingUrl, pendingInit] = network.mock.calls.at(-1)!;
      const map = document.querySelector('.leaflet-container')!;
      const path = document.querySelector('.leaflet-overlay-pane path')!;
      const pathMarkup = path.outerHTML;
      const distance = screen.getByTestId('text-walk-distance').textContent;
      const sketch = screen.getByTestId('text-walk-sketch').textContent;
      const source = screen.getByTestId('text-walk-source').textContent;
      const remove = vi.spyOn(L.Map.prototype, 'remove');
      const startedAt = Date.now();

      await act(async () => { fireEvent.click(screen.getByTestId('button-walk-start')); });
      expect(pendingInit!.signal!.aborted).toBe(true);
      expect(screen.getByText('Walking now')).toBeVisible();
      expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('10:00');
      expect(screen.getByTestId('button-walk-done')).toBeEnabled();
      expect(screen.queryByTestId('button-walk-start')).not.toBeInTheDocument();
      const saved = loadLogs().find((entry) => entry.id === log.id)!;
      expect(saved).toMatchObject({ walkStartedAt: startedAt, walkViaPark: false, walkCompleted: false });

      const expectFrozenPlan = () => {
        expect(screen.queryByText('Finding paths')).not.toBeInTheDocument();
        expect(screen.getByTestId('text-walk-distance').textContent).toBe(distance);
        expect(screen.getByTestId('text-walk-sketch').textContent).toBe(sketch);
        expect(screen.getByTestId('text-walk-source').textContent).toBe(source);
        expect(screen.queryByTestId('text-walk-park')).not.toBeInTheDocument();
        expect(document.querySelector('.leaflet-container')).toBe(map);
        expect(document.querySelector('.leaflet-overlay-pane path')).toBe(path);
        expect(path.outerHTML).toBe(pathMarkup);
        expect(remove).not.toHaveBeenCalled();
        expect(loadLogs().find((entry) => entry.id === log.id)).toEqual(saved);
      };
      expectFrozenPlan();
      if (behavior === 'returns late success') {
        // Both responses would otherwise replace the sketch with a longer park route.
        await act(async () => {
          resolve(stage === 'overpass' ? parkResponse() : routeResponse(String(pendingUrl), 1450));
        });
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expectFrozenPlan();
      expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('9:50');
      const events = vi.mocked(trackSpikeEvent).mock.calls.map(([payload]) => payload);
      expect(events.filter(({ event }) => event === 'walk_started')).toEqual([
        expect.objectContaining({ minutes: 10, via_park: false }),
      ]);
      expect(events.filter(({ event }) => event === 'movement_started')).toHaveLength(1);
    },
  );

  it('does not claim walking began when the Start storage write fails', async () => {
    locationResult();
    const network = mockWalkNetwork({
      overpass: stage === 'overpass' ? untilAborted : parkResponse,
      routing: untilAborted,
    });
    const log = openSavedWalk();
    await find();
    const signal = network.mock.calls.at(-1)![1]!.signal!;
    const before = loadLogs();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Fixture storage is full', 'QuotaExceededError');
    });

    await act(async () => { fireEvent.click(screen.getByTestId('button-walk-start')); });
    expect(write).toHaveBeenCalledWith('spike.logs.v1', expect.any(String));
    expect(screen.getByTestId('text-save-error')).toHaveTextContent('Nothing was updated');
    expect(screen.queryByText('Walking now')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-walk-timer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-walk-done')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-walk-start')).toBeEnabled();
    expect(screen.getByTestId('text-walk-sketch')).toBeVisible();
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('Finding paths')).not.toBeInTheDocument();
    expect(loadLogs()).toEqual(before);
    expect(loadLogs().find((entry) => entry.id === log.id)?.walkStartedAt).toBeUndefined();
    const events = vi.mocked(trackSpikeEvent).mock.calls.map(([payload]) => payload.event);
    expect(events).not.toContain('walk_started');
    expect(events).not.toContain('movement_started');
  });
});

describe('map privacy and navigation lifetime', () => {
  it.each([
    ['success', undefined],
    ['permission denied', 1],
    ['position unavailable', 2],
    ['timeout', 3],
  ] as const)(
    'ignores late location %s after navigation and accepts a fresh request on return', async (_outcome, code) => {
      const geolocation = deferredLocation();
      const network = mockWalkNetwork();
      const createMap = vi.spyOn(L, 'map');
      const tileLayer = vi.spyOn(L, 'tileLayer');
      const log = seedWalk({ demo: false });
      const location = memoryLocation();
      render(<Router hook={location.hook}>
        <Route path="/"><WalkSuggestion log={log} onStart={() => true} onComplete={() => true} onUndo={() => true} /></Route>
        <Route path="/away"><p>Away</p></Route>
      </Router>);

      await find();
      expect(geolocation).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('button-find-walk')).toBeDisabled();
      const [success, error] = geolocation.mock.calls[0]!;
      act(() => { location.navigate('/away'); });
      expect(screen.getByText('Away')).toBeVisible();
      expect(screen.queryByTestId('card-walk')).not.toBeInTheDocument();

      await act(async () => {
        if (code === undefined) {
          success({ coords: {
            latitude: USER_LOCATION[0], longitude: USER_LOCATION[1],
          } } as GeolocationPosition);
        } else {
          error!({ code, message: 'Late fixture failure' } as GeolocationPositionError);
        }
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByText('Away')).toBeVisible();
      expect(screen.queryByTestId('map-walk')).not.toBeInTheDocument();
      expect(document.querySelector('.leaflet-container')).toBeNull();
      expect(createMap).not.toHaveBeenCalled();
      expect(tileLayer).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
      const lateEvents = vi.mocked(trackSpikeEvent).mock.calls.map(([payload]) => payload.event);
      expect(lateEvents).not.toContain('walk_map_opened');
      expect(lateEvents).not.toContain('location_denied');

      act(() => { location.navigate('/'); });
      expect(screen.getByTestId('button-find-walk')).toBeEnabled();
      await find();
      expect(geolocation).toHaveBeenCalledTimes(2);
      expect(network).not.toHaveBeenCalled();
      expect(createMap).not.toHaveBeenCalled();
      await act(async () => {
        geolocation.mock.calls[1]![0]({ coords: {
          latitude: USER_LOCATION[0], longitude: USER_LOCATION[1],
        } } as GeolocationPosition);
      });
      expect(document.querySelectorAll('.leaflet-container')).toHaveLength(1);
      expect(tileLayer).toHaveBeenCalled();
      expect(network).toHaveBeenCalledTimes(2);
      expect(network.mock.calls[0]![0]).toBe(OVERPASS);
      expect(String(network.mock.calls[1]![0]).startsWith(ROUTING)).toBe(true);
      expect(screen.getByTestId('text-walk-source')).toHaveTextContent('Starting from your location');
      expect(screen.getByTestId('button-walk-start')).toBeEnabled();
      attribution();
      const events = vi.mocked(trackSpikeEvent).mock.calls.map(([payload]) => payload.event);
      expect(events.filter((event) => event === 'walk_map_opened')).toHaveLength(1);
      expect(events).not.toContain('location_denied');
    },
  );

  it('saves only walk progress and sends allowlisted analytics, never coordinates', async () => {
    locationResult();
    mockWalkNetwork({ overpass: parkResponse });
    const log = seedWalk({ demo: false });
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const location = memoryLocation({ path: `/?log=${encodeURIComponent(log.id)}` });
    render(<Router hook={location.hook}><Home /></Router>);
    await find();
    fireEvent.click(screen.getByTestId('button-walk-start'));
    fireEvent.click(screen.getByTestId('button-walk-done'));
    expect(loadLogs().find((entry) => entry.id === log.id)).toMatchObject({
      walkCompleted: true, walkViaPark: true, walkStartedAt: expect.any(Number),
    });
    expect(writes).toHaveBeenCalled(); // Exercise real persistence, not a no-op callback.
    const events = vi.mocked(trackSpikeEvent).mock.calls.map(([payload]) => payload);
    for (const event of [
      'walk_map_opened', 'walk_started', 'walk_completed', 'movement_started', 'movement_completed',
    ]) expect(events.some((payload) => payload.event === event)).toBe(true);
    for (const payload of events.filter(({ event }) => event.startsWith('walk_'))) {
      expect(Object.keys(payload).every((key) => ['event', 'distinctId', 'minutes', 'via_park'].includes(key))).toBe(true);
    }
    const persisted = JSON.stringify({
      writes: writes.mock.calls,
      local: { ...localStorage },
      session: { ...sessionStorage },
      events,
    });
    for (const coordinate of [...USER_LOCATION, ...PARK_LOCATION]) {
      expect(persisted).not.toContain(String(coordinate));
    }
    expect(persisted).not.toMatch(/latitude|longitude|waypoints|geometry|parkName/);
    expect(persisted).not.toContain(PARK_NAME);
  });

  it.each(['overpass', 'routing'] as const)(
    'removes Leaflet and aborts pending %s when navigating away, then mounts cleanly', async (stage) => {
      locationResult();
      const network = mockWalkNetwork(stage === 'overpass'
        ? { overpass: untilAborted } : { routing: untilAborted });
      const remove = vi.spyOn(L.Map.prototype, 'remove');
      const invalidate = vi.spyOn(L.Map.prototype, 'invalidateSize');
      const log = seedWalk({ demo: false });
      const location = memoryLocation();
      render(<Router hook={location.hook}>
        <Route path="/"><WalkSuggestion log={log} onStart={() => true} onComplete={() => true} onUndo={() => true} /></Route>
        <Route path="/away"><p>Away</p></Route>
      </Router>);
      await find();
      expect(network).toHaveBeenCalledTimes(stage === 'overpass' ? 1 : 2);
      const signal = network.mock.calls.at(-1)![1]!.signal!;
      const oldContainer = document.querySelector('.leaflet-container')!;
      act(() => { location.navigate('/away'); });
      expect(screen.getByText('Away')).toBeVisible();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(oldContainer).not.toBeInTheDocument();
      expect(oldContainer.querySelector('.leaflet-map-pane')).toBeNull();
      expect(signal.aborted).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(invalidate).not.toHaveBeenCalled(); // The map's delayed resize was cleared.
      expect(document.querySelector('.leaflet-container')).toBeNull();
      expect(network).toHaveBeenCalledTimes(stage === 'overpass' ? 1 : 2);
      mockWalkNetwork();
      act(() => { location.navigate('/'); });
      await find();
      expect(document.querySelectorAll('.leaflet-container')).toHaveLength(1);
      attribution();
    },
  );

  it('ignores a late successful route after navigation even if the network ignores abort', async () => {
    locationResult();
    let resolve!: (response: Response) => void;
    const network = mockWalkNetwork({ routing: () => new Promise((done) => { resolve = done; }) });
    const view = openCard();
    await find();
    const remove = vi.spyOn(L.Map.prototype, 'remove');
    view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    const routeUrl = String(network.mock.calls.find(([url]) => String(url).startsWith(ROUTING))![0]);
    await act(async () => { resolve(routeResponse(routeUrl)); });
    expect(document.querySelector('.leaflet-container')).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]![0]).toBe(OVERPASS);
  });
});
