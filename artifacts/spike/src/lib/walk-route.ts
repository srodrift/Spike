export type LatLng = [number, number];
export interface WalkPlan {
  start: LatLng;
  waypoints: LatLng[];
  path: LatLng[];
  distanceMeters: number;
  viaPark: boolean;
  parkName?: string;
  routed: boolean;
  note?: string;
}

export const FALLBACK_LOCATION: LatLng = [37.7879, -122.4074];
const EARTH_RADIUS = 6_371_000;
const radians = (degrees: number) => degrees * Math.PI / 180;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const lat = radians(b[0] - a[0]);
  const lon = radians(b[1] - a[1]);
  const h = Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(lon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function offset(start: LatLng, north: number, east: number): LatLng {
  const longitudeScale = Math.max(0.01, Math.abs(Math.cos(radians(start[0]))));
  return [start[0] + north / 111_195, start[1] + east / (111_195 * longitudeScale)];
}

function length(path: LatLng[]): number {
  return path.slice(1).reduce((sum, point, i) => sum + distanceMeters(path[i]!, point), 0);
}

/** ~800m schematic square; deliberately NOT represented as verified footpaths. */
export function defaultWalk(start: LatLng): WalkPlan {
  const waypoints: LatLng[] = [offset(start, 200, 0), offset(start, 200, 200), offset(start, 0, 200)];
  const path = [start, ...waypoints, start];
  return {
    start, waypoints, path, distanceMeters: length(path), viaPark: false, routed: false,
    note: 'Suggested loop only, not verified walking directions. Check paths and crossings before you walk.',
  };
}

interface Park { name: string; location: LatLng }
interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: { name?: string };
}

function validPoint(point: unknown): point is LatLng {
  return Array.isArray(point) && point.length === 2 &&
    typeof point[0] === 'number' && typeof point[1] === 'number' &&
    Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180;
}

export function nearestPark(elements: OverpassElement[], start: LatLng): Park | undefined {
  return elements.map((element) => ({
    name: element.tags?.name || 'nearby green space',
    location: [element.center?.lat ?? element.lat, element.center?.lon ?? element.lon],
  })).filter((park): park is Park => validPoint(park.location) && distanceMeters(start, park.location) <= 800)
    .sort((a, b) => distanceMeters(start, a.location) - distanceMeters(start, b.location))[0];
}

async function nearbyPark(start: LatLng, parent: AbortSignal): Promise<Park | undefined> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(4000)]);
  const area = `(around:800,${start[0]},${start[1]})`;
  const query = `[out:json][timeout:3];(
    nwr["leisure"~"^(park|garden|nature_reserve)$"]${area};
    nwr["landuse"~"^(recreation_ground|forest|grass|meadow)$"]${area};
  );out center tags;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('Green-space lookup unavailable');
  const data = await response.json() as { elements?: OverpassElement[] };
  return nearestPark(Array.isArray(data.elements) ? data.elements : [], start);
}

function loopViaPark(start: LatLng, park: Park): WalkPlan {
  const distance = distanceMeters(start, park.location);
  if (distance < 30) {
    const plan = defaultWalk(start);
    // Keep the green-space point in the route, even when the user is already inside it.
    const waypoints: LatLng[] = [plan.waypoints[0]!, park.location, plan.waypoints[2]!];
    const path = [start, ...waypoints, start];
    return { ...plan, waypoints, path, distanceMeters: length(path), parkName: park.name };
  }
  // Ellipse with foci at start and park; perimeter can only be ~800m if park is near enough.
  const north = (park.location[0] - start[0]) * 111_195;
  const east = (park.location[1] - start[1]) * 111_195 * Math.cos(radians(start[0]));
  const halfSide = Math.sqrt(Math.max(0, 400 ** 2 - distance ** 2)) / 2;
  const side = Math.max(15, halfSide);
  const center = offset(start, north / 2, east / 2);
  const first = offset(center, -east / distance * side, north / distance * side);
  const third = offset(center, east / distance * side, -north / distance * side);
  const waypoints: LatLng[] = [first, park.location, third];
  const path = [start, ...waypoints, start];
  return {
    start, waypoints, path, distanceMeters: length(path), viaPark: false,
    parkName: park.name, routed: false,
    note: `Green-space candidate: ${park.name}. This sketch is not verified walking directions.`,
  };
}

async function pedestrianRoute(plan: WalkPlan, parent: AbortSignal): Promise<WalkPlan> {
  const coordinates = [plan.start, ...plan.waypoints, plan.start]
    .map(([lat, lon]) => `${lon},${lat}`).join(';');
  const response = await fetch(
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordinates}?overview=full&geometries=geojson&steps=false`,
    {
      signal: AbortSignal.any([parent, AbortSignal.timeout(5000)]),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    },
  );
  if (!response.ok) throw new Error('Walking directions unavailable');
  const data = await response.json() as {
    code?: string;
    routes?: { distance: number; geometry: { coordinates: number[][] } }[];
    waypoints?: { location: number[] }[];
  };
  const route = data.routes?.[0];
  if (data.code !== 'Ok' || !route || !Number.isFinite(route.distance) || route.distance <= 0) {
    throw new Error('No walking route found');
  }
  const path = route.geometry.coordinates.map((point) => [point[1], point[0]]);
  if (!path.length || !path.every(validPoint)) throw new Error('Invalid walking route');
  const snapped = data.waypoints?.map((point) => [point.location[1], point.location[0]]);
  // A route snapped far from the user or green-space target isn't a useful walk.
  if (!snapped || snapped.length < 5 || !snapped.every(validPoint) || distanceMeters(plan.start, snapped[0]!) > 150 ||
      (plan.parkName && distanceMeters(plan.waypoints[1]!, snapped[2]!) > 100)) {
    throw new Error('Route is too far from the chosen places');
  }
  return {
    ...plan,
    path,
    distanceMeters: route.distance,
    routed: true,
    viaPark: !!plan.parkName,
    note: route.distance > 1100
      ? 'This loop is longer than 10 minutes. For a shorter walk, turn back after 5 minutes. Check local paths and crossings.'
      : 'Suggested pedestrian route, not turn-by-turn navigation. Check local paths and crossings.',
  };
}

/** Location remains transient and is shared only with map/route services, never analytics. */
export async function findWalk(start: LatLng, signal: AbortSignal): Promise<WalkPlan> {
  if (!validPoint(start)) throw new Error('Invalid start location');
  let park: Park | undefined;
  try { park = await nearbyPark(start, signal); }
  catch { if (signal.aborted) throw signal.reason; }
  const plan = park ? loopViaPark(start, park) : defaultWalk(start);
  try {
    const routeSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    const first = await pedestrianRoute(plan, routeSignal);
    if (!park && (first.distanceMeters > 1100 || first.distanceMeters < 550)) {
      // Street snapping may inflate the square. One bounded correction aims for ~800m.
      const scale = Math.max(0.3, Math.min(2, 800 / first.distanceMeters));
      const waypoints = plan.waypoints.map(([lat, lon]): LatLng => [
        start[0] + (lat - start[0]) * scale,
        start[1] + (lon - start[1]) * scale,
      ]);
      const resized = { ...plan, waypoints, path: [start, ...waypoints, start] };
      try {
        const corrected = await pedestrianRoute(resized, routeSignal);
        if (Math.abs(corrected.distanceMeters - 800) < Math.abs(first.distanceMeters - 800)) return corrected;
      } catch { if (signal.aborted) throw signal.reason; }
    }
    return first;
  }
  catch {
    if (signal.aborted) throw signal.reason;
    // Preserve a usable ~800m drawing; do not claim a failed route goes through a park.
    return { ...defaultWalk(start), note: 'Walking directions unavailable. This is an ~800 m sketch only, not a verified route; check paths and crossings.' };
  }
}
