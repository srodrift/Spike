import { vi } from 'vitest';
import type { LatLng } from '@/lib/walk-route';

// Distinct from demo meals and the Union Square fallback, for privacy assertions.
export const USER_LOCATION: LatLng = [40.71281, -74.00597];
export const PARK_LOCATION: LatLng = [40.71521, -74.00597];
export const PARK_NAME = 'Fixture Green';
export const OVERPASS = 'https://overpass-api.de/api/interpreter';
export const ROUTING = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export function parkResponse() {
  return jsonResponse({ elements: [{
    center: { lat: PARK_LOCATION[0], lon: PARK_LOCATION[1] },
    tags: { name: PARK_NAME },
  }] });
}

/** Echo the requested waypoints as snapped points, in the router's lon/lat order. */
export function routeResponse(url: string, distance = 860) {
  const coordinates = url.slice(ROUTING.length).split('?')[0]!
    .split(';').map((pair) => pair.split(',').map(Number));
  return jsonResponse({
    code: 'Ok',
    routes: [{ distance, geometry: { coordinates } }],
    waypoints: coordinates.map((location) => ({ location })),
  });
}

export type NetworkReply = (url: string, init: RequestInit) => Promise<Response> | Response;

/** Only the two expected services are allowed; a new endpoint fails the test. */
export function mockWalkNetwork({
  overpass = () => jsonResponse({ elements: [] }),
  routing = (url) => routeResponse(url),
}: { overpass?: NetworkReply; routing?: NetworkReply } = {}) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === OVERPASS) return overpass(url, init);
    if (url.startsWith(ROUTING)) return routing(url, init);
    throw new Error(`Unexpected walk request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** Like a stalled fetch: rejects only when its supplied signal is aborted. */
export function untilAborted(_url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal!;
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** Native AbortSignal.timeout uses a different clock; connect it to fake timers. */
export function mockAbortTimeouts() {
  return vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
}
