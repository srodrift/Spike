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
