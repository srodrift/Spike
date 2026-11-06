import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultWalk, distanceMeters, FALLBACK_LOCATION, findWalk, nearestPark } from './walk-route';
import {
  jsonResponse, mockAbortTimeouts, mockWalkNetwork, OVERPASS, PARK_LOCATION,
  PARK_NAME, parkResponse, ROUTING, routeResponse, untilAborted, USER_LOCATION,
} from '@/test/walk-network';

beforeEach(() => {
  vi.useFakeTimers();
  mockAbortTimeouts();
});

describe('walk route network boundaries', () => {
  it('makes an honest closed ~800m Union Square sketch without any network request', () => {
    const plan = defaultWalk(FALLBACK_LOCATION);
    expect(plan).toMatchObject({
      start: [37.7879, -122.4074], routed: false, viaPark: false,
      note: expect.stringContaining('not verified walking directions'),
    });
    expect(plan.distanceMeters).toBeGreaterThan(790);
    expect(plan.distanceMeters).toBeLessThan(810);
    expect(plan.path[0]).toEqual(plan.path.at(-1));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborts Overpass at four seconds and still obtains a pedestrian loop', async () => {
    const network = mockWalkNetwork({ overpass: untilAborted });
    const pending = findWalk(USER_LOCATION, new AbortController().signal);
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(3999);
    expect(network).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    const overpassSignal = network.mock.calls[0]![1]!.signal!;
    expect(overpassSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const plan = await pending;
    expect(overpassSignal.aborted).toBe(true);
    expect(plan).toMatchObject({ routed: true, viaPark: false, distanceMeters: 860 });
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls[1]![0]).toMatch(ROUTING);
  });

  it.each(['rejected', 'http', 'no-route', 'invalid-geometry', 'far-snap', 'timeout'] as const)(
    'keeps an honest schematic when routing fails: %s', async (failure) => {
      const network = mockWalkNetwork({
        overpass: parkResponse,
        routing: (url, init) => {
          if (failure === 'rejected') throw new TypeError('Offline');
          if (failure === 'http') return jsonResponse({}, 503);
          if (failure === 'no-route') return jsonResponse({ code: 'NoRoute', routes: [] });
          if (failure === 'timeout') return untilAborted(url, init);
          const points = Array.from({ length: 5 }, () => ({ location: [0, 0] }));
          return jsonResponse({
            code: 'Ok',
            routes: [{ distance: 800, geometry: {
              coordinates: failure === 'invalid-geometry' ? [[999, 999]] : [[-74.00597, 40.71281]],
            } }],
            waypoints: points,
          });
        },
      });
      const pending = findWalk(USER_LOCATION, new AbortController().signal);
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(5000);
      const plan = await pending;
      expect(plan).toMatchObject({
        start: USER_LOCATION, routed: false, viaPark: false,
        note: expect.stringContaining('not a verified route'),
      });
      expect(plan.parkName).toBeUndefined();
      expect(plan.distanceMeters).toBeGreaterThan(790);
      expect(plan.distanceMeters).toBeLessThan(810);
      expect(network).toHaveBeenCalledTimes(2);
    },
  );

  it('claims a park only after pedestrian routing succeeds, and uses the returned distance', async () => {
    const network = mockWalkNetwork({
      overpass: parkResponse,
      routing: (url) => routeResponse(url, 1450),
    });
    const plan = await findWalk(USER_LOCATION, new AbortController().signal);
    expect(plan).toMatchObject({
      routed: true, viaPark: true, parkName: PARK_NAME, distanceMeters: 1450,
      note: expect.stringContaining('longer than 10 minutes'),
    });
    expect(plan.waypoints[1]).toEqual(PARK_LOCATION);
    expect(plan.path).toContainEqual(PARK_LOCATION);
    expect(plan.path[0]).toEqual(plan.path.at(-1));
    const [url, init] = network.mock.calls[0]!;
    expect(url).toBe(OVERPASS);
    expect(init).toMatchObject({
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    expect(new URLSearchParams(String(init!.body)).get('data')).toContain('around:800,40.71281,-74.00597');
    expect(network.mock.calls[1]![1]).toMatchObject({
      credentials: 'omit', referrerPolicy: 'no-referrer',
    });
  });

  describe('no-park street-snapping correction', () => {
    it.each([
      { first: 400, scale: 2 },
      { first: 1600, scale: 0.5 },
      { first: 100, scale: 2 },
      { first: 4000, scale: 0.3 },
    ])('resizes a $first m route once by $scale, with fixed start and end', async ({ first, scale }) => {
      const routing = vi.fn((url: string) => routeResponse(url, routing.mock.calls.length === 1 ? first : 800));
      const network = mockWalkNetwork({ routing });
      const plan = await findWalk(USER_LOCATION, new AbortController().signal);

      expect(network).toHaveBeenCalledTimes(3);
      expect(network.mock.calls[0]![0]).toBe(OVERPASS);
      expect(routing).toHaveBeenCalledTimes(2);
      const requestedPoints = routing.mock.calls.map(([url]) =>
        url.slice(ROUTING.length).split('?')[0]!.split(';')
          .map((pair) => pair.split(',').map(Number)),
      );
      const [initial, resized] = requestedPoints;
      const start = [USER_LOCATION[1], USER_LOCATION[0]];
      expect(initial).toHaveLength(5);
      expect(resized).toHaveLength(5);
      expect(initial![0]).toEqual(start);
      expect(initial!.at(-1)).toEqual(start);
      expect(resized![0]).toEqual(start);
      expect(resized!.at(-1)).toEqual(start);
      for (let i = 1; i <= 3; i++) {
        expect(resized![i]![0]).toBeCloseTo(start[0]! + (initial![i]![0]! - start[0]!) * scale, 10);
        expect(resized![i]![1]).toBeCloseTo(start[1]! + (initial![i]![1]! - start[1]!) * scale, 10);
      }
      expect(plan).toMatchObject({
        start: USER_LOCATION, routed: true, viaPark: false, distanceMeters: 800,
        path: resized!.map(([lon, lat]) => [lat, lon]),
        waypoints: resized!.slice(1, -1).map(([lon, lat]) => [lat, lon]),
      });
      expect(plan.parkName).toBeUndefined();
    });

    it.each([550, 800, 1100])('does not resize an in-range %i m route', async (distance) => {
      const routing = vi.fn((url: string) => routeResponse(url, distance));
      const network = mockWalkNetwork({ routing });
      const plan = await findWalk(USER_LOCATION, new AbortController().signal);
      expect(plan).toMatchObject({ distanceMeters: distance, routed: true, viaPark: false });
      expect(routing).toHaveBeenCalledTimes(1);
      expect(network).toHaveBeenCalledTimes(2);
    });

    it.each([
      { first: 500, corrected: 540, selected: 540 },
      { first: 1200, corrected: 1150, selected: 1150 },
      { first: 500, corrected: 1200, selected: 500 },
      { first: 1200, corrected: 300, selected: 1200 },
      { first: 500, corrected: 1100, selected: 500 },
    ])('keeps the closer route for $first → $corrected m, without a third attempt', async ({
      first, corrected, selected,
    }) => {
      const routing = vi.fn((url: string) => routeResponse(url, routing.mock.calls.length === 1 ? first : corrected));
      const network = mockWalkNetwork({ routing });
      const plan = await findWalk(USER_LOCATION, new AbortController().signal);
      expect(routing).toHaveBeenCalledTimes(2);
      expect(network).toHaveBeenCalledTimes(3);
      const selectedUrl = routing.mock.calls[selected === first ? 0 : 1]![0];
      const selectedRoute = await routeResponse(selectedUrl, selected).json();
      expect(plan).toMatchObject({
        distanceMeters: selected, routed: true, viaPark: false,
        path: selectedRoute.routes[0].geometry.coordinates.map(([lon, lat]: number[]) => [lat, lon]),
      });
      expect(plan.parkName).toBeUndefined();
      if (selected > 1100) expect(plan.note).toContain('longer than 10 minutes');
      else expect(plan.note).not.toContain('longer than 10 minutes');
    });

    it.each(['rejected', 'http', 'no-route', 'invalid-geometry', 'timeout'] as const)(
      'retains the first valid long route when correction fails: %s', async (failure) => {
        const routing = vi.fn((url: string, init: RequestInit) => {
          if (routing.mock.calls.length === 1) return routeResponse(url, 1450);
          if (failure === 'rejected') throw new TypeError('Offline during correction');
          if (failure === 'http') return jsonResponse({}, 503);
          if (failure === 'no-route') return jsonResponse({ code: 'NoRoute', routes: [] });
          if (failure === 'timeout') return untilAborted(url, init);
          return jsonResponse({
            code: 'Ok',
            routes: [{ distance: 800, geometry: { coordinates: [[999, 999]] } }],
          });
        });
        const network = mockWalkNetwork({ routing });
        const pending = findWalk(USER_LOCATION, new AbortController().signal);
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(5000);
        const plan = await pending;
        expect(routing).toHaveBeenCalledTimes(2);
        expect(network).toHaveBeenCalledTimes(3);
        expect(plan).toMatchObject({
          start: USER_LOCATION, routed: true, viaPark: false, distanceMeters: 1450,
          waypoints: defaultWalk(USER_LOCATION).waypoints,
          path: defaultWalk(USER_LOCATION).path,
          note: expect.stringContaining('longer than 10 minutes'),
        });
        expect(plan.parkName).toBeUndefined();
        if (failure === 'timeout') expect(routing.mock.calls[1]![1].signal!.aborted).toBe(true);
      },
    );

    it('bounds correction by the original routing deadline, not a fresh five seconds', async () => {
      const routing = vi.fn((url: string, init: RequestInit) => {
        if (routing.mock.calls.length === 1) {
          return new Promise<Response>((resolve) => setTimeout(() => resolve(routeResponse(url, 1450)), 3000));
        }
        return untilAborted(url, init);
      });
      mockWalkNetwork({ routing });
      const pending = findWalk(USER_LOCATION, new AbortController().signal);
      let settled = false;
      void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(3000);
      expect(routing).toHaveBeenCalledTimes(2);
      const correctionSignal = routing.mock.calls[1]![1].signal!;
      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      expect(correctionSignal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ routed: true, distanceMeters: 1450 });
      expect(correctionSignal.aborted).toBe(true);
      expect(routing).toHaveBeenCalledTimes(2);
    });

    it('propagates parent cancellation during correction rather than returning the first route', async () => {
      const routing = vi.fn((url: string, init: RequestInit) =>
        routing.mock.calls.length === 1 ? routeResponse(url, 1450) : untilAborted(url, init),
      );
      const network = mockWalkNetwork({ routing });
      const controller = new AbortController();
      const pending = findWalk(USER_LOCATION, controller.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(routing).toHaveBeenCalledTimes(2);
      const correctionSignal = routing.mock.calls[1]![1].signal!;
      expect(correctionSignal.aborted).toBe(false);
      const reason = new DOMException('Walk map closed during correction', 'AbortError');
      const rejects = expect(pending).rejects.toBe(reason);
      controller.abort(reason);
      await rejects;
      expect(correctionSignal.aborted).toBe(true);
      expect(network).toHaveBeenCalledTimes(3);
    });
  });

  it.each(['overpass', 'routing'] as const)('propagates navigation cancellation during %s', async (stage) => {
    const network = mockWalkNetwork(stage === 'overpass'
      ? { overpass: untilAborted }
      : { routing: untilAborted });
    const controller = new AbortController();
    const pending = findWalk(USER_LOCATION, controller.signal);
    // Flush resolved Overpass/json promises, without advancing the deadline.
    await vi.advanceTimersByTimeAsync(0);
    expect(network).toHaveBeenCalledTimes(stage === 'overpass' ? 1 : 2);
    const rejects = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejects;
    expect(network.mock.calls.at(-1)![1]!.signal!.aborted).toBe(true);
  });

  it('picks the nearest valid green space within 800m', () => {
    expect(nearestPark([
      { lat: NaN, lon: 0 },
      { lat: 91, lon: 0 },
      { lat: 41, lon: -74 },
      { center: { lat: PARK_LOCATION[0], lon: PARK_LOCATION[1] }, tags: { name: 'Further' } },
      { lat: USER_LOCATION[0] + 0.001, lon: USER_LOCATION[1] },
    ], USER_LOCATION)).toEqual({
      name: 'nearby green space', location: [USER_LOCATION[0] + 0.001, USER_LOCATION[1]],
    });
    expect(distanceMeters(USER_LOCATION, PARK_LOCATION)).toBeLessThan(800);
  });
});
