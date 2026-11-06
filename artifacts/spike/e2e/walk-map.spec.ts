import { expect, test, type Page } from '@playwright/test';
import type { MealLog } from '../src/lib/spike';

const USER = [40.71281, -74.00597];
const PARK = [40.71521, -74.00597];
const PARK_NAME = 'Fixture Green';
const ROUTING = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
type Scenario = 'denied' | 'unsupported' | 'timeout' | 'slow-overpass' | 'route-failure' | 'park';

async function openWalk(page: Page, scenario: Scenario) {
  const events: Record<string, unknown>[] = [];
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Intercept analytics before seeding a non-demo meal. Never contact the relay.
  await page.route('**/api/spike/**', async (route) => {
    expect(new URL(route.request().url()).pathname).toBe('/api/spike/events');
    events.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  await page.route('https://*.tile.openstreetmap.org/**', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eee" d="M0 0h256v256H0z"/></svg>',
  }));
  let releaseOverpass!: () => void;
  await page.route('https://overpass-api.de/api/interpreter', async (route) => {
    requests.push(route.request().url());
    if (scenario === 'slow-overpass') await new Promise<void>((resolve) => { releaseOverpass = resolve; });
    await route.fulfill({ json: { elements: [{
      center: { lat: PARK[0], lon: PARK[1] }, tags: { name: PARK_NAME },
    }] } }).catch(() => undefined); // A timed-out browser request may be gone.
  });
  await page.route(`${ROUTING}**`, async (route) => {
    requests.push(route.request().url());
    if (scenario !== 'park' && scenario !== 'slow-overpass') {
      await route.fulfill({ status: 503, json: {} });
      return;
    }
    const coordinates = route.request().url().slice(ROUTING.length).split('?')[0]!
      .split(';').map((pair) => pair.split(',').map(Number));
    await route.fulfill({ json: {
      code: 'Ok',
      routes: [{ distance: 1450, geometry: { coordinates } }],
      waypoints: coordinates.map((location) => ({ location })),
    } });
  });
  await page.addInitScript(({ scenario, user }) => {
    if (scenario === 'unsupported') {
      delete (Navigator.prototype as { geolocation?: Geolocation }).geolocation;
    } else {
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
        getCurrentPosition(success: PositionCallback, error: PositionErrorCallback, options: PositionOptions) {
          // Record only timeout configuration, never coordinates.
          (window as unknown as { locationTimeout: number }).locationTimeout = options.timeout!;
          if (scenario === 'denied' || scenario === 'timeout') {
            error({ code: scenario === 'denied' ? 1 : 3 } as GeolocationPositionError);
          } else success({ coords: { latitude: user[0], longitude: user[1] } } as GeolocationPosition);
        },
      } });
    }
    const writes: string[] = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      writes.push(`${key}:${value}`);
      original.call(this, key, value);
    };
    (window as unknown as { storageWrites: string[] }).storageWrites = writes;
  }, { scenario, user: USER });
  await page.goto('/');
  // Vite module imports let the test use the product's real seed generator.
  const id = await page.evaluate(async () => {
    const modulePath = `${location.origin}/src/lib/spike.ts`;
    const spike = await import(/* @vite-ignore */ modulePath);
    spike.loadDemoWeek();
    const meal = spike.loadLogs().findLast((log: MealLog) => !log.walkCompleted);
    spike.clearDemoData();
    spike.upsertLog({ ...meal, demo: false, appliedFixes: ['walk'], walkCompleted: false });
    localStorage.setItem('spike.movement.settings.v1', JSON.stringify({
      pain: false, doctorLimit: false, location: 'out',
    }));
    return meal.id as string;
  });
  await page.goto(`/?log=${encodeURIComponent(id)}`);
  await page.getByTestId('button-find-walk').click();
  return { events, requests, errors, releaseOverpass: () => releaseOverpass?.(), id };
}

async function expectAttribution(page: Page) {
  const link = page.getByTestId('map-walk').getByRole('link', { name: 'OpenStreetMap' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
}

for (const [scenario, notice] of [
  ['denied', 'Location permission was denied.'],
  ['unsupported', 'Location is not available in this browser'],
  ['timeout', 'Finding your location took too long.'],
] as const) {
  test(`${scenario}: Union Square fallback stays honest and usable`, async ({ page }) => {
    const { events, requests, errors } = await openWalk(page, scenario);
    await expect(page.getByTestId('text-walk-notice')).toContainText(notice);
    await expect(page.getByTestId('text-walk-source')).toHaveText('Example start: Union Square, SF');
    await expect(page.getByText('Finding paths')).toHaveCount(0);
    await expect(page.getByTestId('text-walk-sketch')).toContainText('not verified walking directions');
    await expect(page.getByTestId('button-walk-start')).toBeEnabled();
    await expectAttribution(page);
    expect(requests.some((url) => url.includes('-122.4074,37.7879'))).toBe(true);
    await expect.poll(() => events.filter((event) => event.event === 'walk_map_opened').length).toBe(1);
    expect(events.filter((event) => event.event === 'location_denied')).toHaveLength(scenario === 'denied' ? 1 : 0);
    expect(errors).toEqual([]);
  });
}

test('Overpass cannot block the usable sketch beyond four seconds', async ({ page }) => {
  const { requests, releaseOverpass, errors } = await openWalk(page, 'slow-overpass');
  await expect(page.getByText('Finding paths')).toBeVisible();
  await expect(page.getByTestId('text-walk-sketch')).toBeVisible();
  await expect(page.getByTestId('button-walk-start')).toBeEnabled();
  await expectAttribution(page);
  // The Overpass handler is still held. Only the application's timeout can proceed.
  await expect(page.getByText('Finding paths')).toHaveCount(0, { timeout: 6500 });
  expect(requests.some((url) => url.startsWith(ROUTING))).toBe(true);
  await expect(page.getByTestId('text-walk-park')).toHaveCount(0);
  await expect(page.getByTestId('text-walk-sketch')).toHaveCount(0);
  releaseOverpass();
  expect(errors).toEqual([]);
});

test('routing failure keeps a dotted sketch, not a park claim', async ({ page }) => {
  const { errors } = await openWalk(page, 'route-failure');
  await expect(page.getByText('Finding paths')).toHaveCount(0);
  await expect(page.getByText(/Walking directions unavailable/)).toBeVisible();
  await expect(page.getByTestId('text-walk-sketch')).toBeVisible();
  await expect(page.getByTestId('text-walk-park')).toHaveCount(0);
  await expect(page.locator('.leaflet-overlay-pane path').first()).toHaveAttribute('stroke-dasharray', '2 8');
  await expectAttribution(page);
  expect(errors).toEqual([]);
});

test('verified park route remains private and the map is removed on navigation', async ({ page }) => {
  const { events, errors, id } = await openWalk(page, 'park');
  await expect(page.getByTestId('text-walk-park')).toHaveText(`Walk via ${PARK_NAME}`);
  await expect(page.getByTestId('text-walk-distance')).toContainText('~1.4 km');
  await expect(page.getByTestId('text-walk-sketch')).toHaveCount(0);
  await expectAttribution(page);
  // Hold a reference to the real map so navigation must remove it, not just hide it.
  await page.evaluate(() => {
    (window as unknown as { oldWalkMap: Element | null }).oldWalkMap = document.querySelector('.leaflet-container');
  });
  await page.getByTestId('button-walk-start').click();
  await page.getByTestId('button-walk-done').click();
  await expect.poll(() => events.some((event) => event.event === 'walk_completed')).toBe(true);
  const persisted = await page.evaluate(() => JSON.stringify({
    local: { ...localStorage }, session: { ...sessionStorage },
    writes: (window as unknown as { storageWrites: string[] }).storageWrites,
  }));
  for (const coordinate of [...USER, ...PARK]) {
    expect(persisted).not.toContain(String(coordinate));
    expect(JSON.stringify(events)).not.toContain(String(coordinate));
  }
  expect(persisted).not.toContain(PARK_NAME);
  // Use the SPA's navigation rather than a full reload.
  await page.locator('a[href="/week"]').first().click();
  await expect(page.getByTestId('map-walk')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const old = (window as unknown as { oldWalkMap: Element }).oldWalkMap;
    return { connected: old.isConnected, pane: !!old.querySelector('.leaflet-map-pane') };
  })).toEqual({ connected: false, pane: false });
  await page.goto(`/?log=${encodeURIComponent(id)}`);
  await page.getByTestId('button-find-walk').click();
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
  await expectAttribution(page);
  expect(errors).toEqual([]);
});
