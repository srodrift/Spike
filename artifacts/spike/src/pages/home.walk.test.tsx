import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { trackSpikeEvent } from '@workspace/api-client-react';
import Home from './home';
import Week from './week';
import { loadLogs, LOGS_CHANGED, type MealLog } from '@/lib/spike';
import { seedWalk } from '@/test/walk-fixtures';
import { loadMovementSettings, saveMovementSettings, type MovementSettings } from '@/lib/movement';

// Rendering charts/audio and fetching/rasterizing maps are unrelated to the
// timer contract. Keep WalkSuggestion, Home, Week and persistence real.
vi.mock('@/components/curve-chart', () => ({ CurveChart: () => null }));
vi.mock('@/components/hear-summary', () => ({ HearSummary: () => null }));
vi.mock('leaflet', () => {
  const layer = () => {
    const result = { addTo: vi.fn(() => result), bindTooltip: vi.fn(() => result) };
    return result;
  };
  return {
    default: {
      map: () => ({ fitBounds: vi.fn(), invalidateSize: vi.fn(), remove: vi.fn() }),
      tileLayer: layer,
      polyline: layer,
      circleMarker: layer,
      marker: layer,
      divIcon: vi.fn(),
      latLngBounds: vi.fn(),
    },
  };
});
vi.mock('@/lib/walk-route', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/walk-route')>();
  return {
    ...original,
    findWalk: vi.fn(async (start) => ({
      ...original.defaultWalk(start),
      viaPark: true,
      parkName: 'Fixture park',
      routed: true,
    })),
  };
});

const START = new Date(2026, 10, 6, 12, 0, 0).getTime();
const TEN_MINUTES = 600_000;
const events = (event: string) => vi.mocked(trackSpikeEvent).mock.calls
  .map(([payload]) => payload).filter((payload) => payload.event === event);
const saved = (log: MealLog) => loadLogs().find((entry) => entry.id === log.id)!;
const click = (id: string) => fireEvent.click(screen.getByTestId(id));

function openMeal(log: MealLog, withWeek = true) {
  const location = memoryLocation({ path: `/?log=${encodeURIComponent(log.id)}` });
  return render(
    <Router hook={location.hook}>
      <Home />
      {withWeek && <Week />}
    </Router>,
  );
}

async function startWalk() {
  await act(async () => { click('button-find-walk'); });
  click('button-walk-start');
}

function failLogWrites(demo = false) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === (demo ? 'spike.demo.logs.v1' : 'spike.logs.v1')) {
      throw new DOMException('Fixture storage is full', 'QuotaExceededError');
    }
    original.call(this, key, value);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    geolocation: {
      getCurrentPosition: vi.fn((success) => success({
        coords: { latitude: 37.7879, longitude: -122.4074 },
      })),
    },
  }));
});

describe('movement safety and suggestion states', () => {
  it('requires the first check before applying any movement suggestion', () => {
    const log = seedWalk({ demo: false, appliedFixes: [] });
    localStorage.removeItem('spike.movement.settings.v1');
    openMeal(log, false);
    click('button-fix-walk');
    expect(screen.getByTestId('form-movement-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('text-reduced')).not.toBeInTheDocument();
    expect(saved(log).appliedFixes).toEqual([]);
    click('radio-pain-no');
    click('radio-doctor-yes');
    click('radio-location-out');
    click('button-movement-save');
    expect(screen.getByTestId('text-doctor-note')).toHaveTextContent('Check with your doctor');
    expect(screen.queryByTestId('text-reduced')).not.toBeInTheDocument();
    expect(saved(log).appliedFixes).toEqual([]);
    expect(events('safety_check_completed')).toHaveLength(1);
    expect(events('safety_check_completed')[0]).not.toHaveProperty('pain');
    expect(events('movement_option_shown')[0]).toMatchObject({ type: 'none' });
  });

  it.each([
    ['home', false, 'home'],
    ['desk', false, 'desk'],
    ['out', true, 'gentle'],
  ] as const)('runs the %s option without counting it as a walk', (location, pain, type) => {
    const log = seedWalk({ demo: false, appliedFixes: [] });
    saveMovementSettings({ pain, doctorLimit: false, location });
    openMeal(log, false);
    click('button-fix-walk');
    expect(screen.getByTestId(`card-movement-${type}`)).toBeInTheDocument();
    click('button-movement-start');
    act(() => { vi.advanceTimersByTime(60_000); });
    click('button-movement-done');
    expect(saved(log)).toMatchObject({ movementType: type, movementCompleted: true, walkCompleted: false });
    expect(events('movement_completed')).toHaveLength(1);
    expect(events('movement_completed')[0]).toMatchObject({ type });
    expect(events('walk_completed')).toHaveLength(0);
  });

  it('shows a reasonable-choice message without applying a nonexistent swap', () => {
    const log = seedWalk({ demo: false, appliedFixes: [] });
    log.estimate.swaps = [];
    localStorage.setItem('spike.logs.v1', JSON.stringify([log]));
    openMeal(log, false);
    expect(screen.getByText('Ways to soften the spike')).toBeInTheDocument();
    expect(screen.getByTestId('button-fix-swap')).toBeDisabled();
    expect(screen.getByTestId('button-fix-swap')).toHaveTextContent("This one's already a reasonable choice");
    click('button-fix-swap');
    expect(saved(log).appliedFixes).toEqual([]);
    expect(screen.queryByTestId('text-reduced')).not.toBeInTheDocument();
  });
});

describe('removing selected fixes through Home', () => {
  it.each([false, true])('clears a removed walk, survives reload and starts fresh (completed: %s)', async (completed) => {
    const log = seedWalk({ appliedFixes: ['walk', 'food_order', 'swap'], movementType: 'walk' });
    const otherMeals = loadLogs().filter((entry) => entry.id !== log.id);
    let view = openMeal(log);
    const baseline = Number(screen.getByTestId('text-stat-walks').textContent);
    await startWalk();
    act(() => { vi.advanceTimersByTime(90_000); });
    if (completed) click('button-walk-done');
    expect(saved(log)).toMatchObject({
      walkStartedAt: START, walkViaPark: true, walkCompleted: completed,
      ...(completed ? { walkMinutes: 1.5 } : {}),
    });
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(baseline + Number(completed)));

    // This is the suggestion toggle, not the completed-walk Undo button.
    click('button-fix-walk');
    const removed = saved(log);
    expect(removed).toMatchObject({ appliedFixes: ['food_order', 'swap'], walkCompleted: false });
    for (const key of [
      'walkStartedAt', 'walkMinutes', 'walkViaPark', 'movementType',
      'movementStartedAt', 'movementCompleted', 'movementMinutes',
    ]) {
      expect(removed).not.toHaveProperty(key);
    }
    expect(loadLogs().filter((entry) => entry.id !== log.id)).toEqual(otherMeals);
    expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('text-walk-timer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-walk-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(baseline));

    view.unmount();
    vi.setSystemTime(START + TEN_MINUTES);
    view = openMeal(log);
    expect(saved(log)).toEqual(removed);
    expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('text-walk-timer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-walk-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(baseline));
    click('button-fix-walk');
    expect(saved(log)).toMatchObject({ movementType: 'walk', walkCompleted: false });
    expect(saved(log)).not.toHaveProperty('walkStartedAt');
    expect(saved(log)).not.toHaveProperty('walkMinutes');
    expect(saved(log)).not.toHaveProperty('walkViaPark');
    expect(screen.queryByTestId('text-walk-timer')).not.toBeInTheDocument();
    await startWalk();
    expect(saved(log)).toMatchObject({ walkStartedAt: START + TEN_MINUTES, walkCompleted: false });
    expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('10:00');
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(baseline));
    click('button-walk-done');
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(baseline + 1));
    view.unmount();
    openMeal(log);
    expect(saved(log).walkCompleted).toBe(true);
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(baseline + 1));
    expect(trackSpikeEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['food_order', false], ['food_order', true],
    ['swap', false], ['swap', true],
  ] as const)('removing %s preserves walk progress (completed: %s)', (fix, completed) => {
    const log = seedWalk({
      appliedFixes: ['walk', 'food_order', 'swap'], movementType: 'walk',
      walkStartedAt: START - 90_000, walkViaPark: true, walkCompleted: completed,
      ...(completed ? { walkMinutes: 1.5 } : {}),
    });
    const view = openMeal(log);
    const count = screen.getByTestId('text-stat-walks').textContent;
    expect(screen.getByTestId(`button-fix-${fix}`)).toBeEnabled();
    click(`button-fix-${fix}`);
    const expected = { ...log, appliedFixes: log.appliedFixes.filter((entry) => entry !== fix) };
    expect(saved(log)).toEqual(expected);
    expect(screen.getByTestId(`button-fix-${fix}`)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
    view.unmount();
    vi.setSystemTime(START + 30_000);
    openMeal(log);
    expect(saved(log)).toEqual(expected);
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
    if (completed) {
      expect(screen.getByTestId('button-walk-undo')).toBeInTheDocument();
      expect(screen.getByTestId('text-walk-status')).toHaveTextContent('1.5 min logged · via a park');
    } else {
      expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('8:00');
      expect(screen.getByTestId('button-walk-done')).toBeEnabled();
    }
    expect(trackSpikeEvent).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves the previous state if removing a walk cannot save (completed: %s)', (completed) => {
    const log = seedWalk({
      appliedFixes: ['walk', 'food_order', 'swap'], movementType: 'walk',
      walkStartedAt: START - 90_000, walkViaPark: true, walkCompleted: completed,
      ...(completed ? { walkMinutes: 1.5 } : {}),
    });
    const view = openMeal(log);
    const count = screen.getByTestId('text-stat-walks').textContent;
    const raw = localStorage.getItem('spike.demo.logs.v1');
    const writes = failLogWrites(true);
    const changed = vi.fn();
    window.addEventListener(LOGS_CHANGED, changed);
    try {
      click('button-fix-walk');
      expect(screen.getByTestId('text-save-error')).toHaveTextContent('Nothing was updated');
      expect(localStorage.getItem('spike.demo.logs.v1')).toBe(raw);
      expect(saved(log)).toEqual(log);
      expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
      expect(changed).not.toHaveBeenCalled();
      if (completed) {
        expect(screen.getByTestId('button-walk-undo')).toBeEnabled();
      } else {
        expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('8:30');
        expect(screen.getByTestId('button-walk-done')).toBeEnabled();
      }
      view.unmount();
      openMeal(log);
      expect(saved(log)).toEqual(log);
      expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
      if (completed) {
        expect(screen.getByTestId('button-walk-undo')).toBeEnabled();
      } else {
        expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('8:30');
      }
      writes.mockRestore();
      click('button-fix-walk');
      expect(saved(log)).toMatchObject({ walkCompleted: false, appliedFixes: ['food_order', 'swap'] });
      expect(saved(log)).not.toHaveProperty('walkStartedAt');
      expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByTestId('text-save-error')).not.toBeInTheDocument();
      expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(Number(count) - Number(completed)));
      expect(changed).toHaveBeenCalledTimes(1);
      expect(trackSpikeEvent).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(LOGS_CHANGED, changed);
    }
  });
});

describe.each([
  { location: 'home', pain: false, type: 'home' },
  { location: 'desk', pain: false, type: 'desk' },
  { location: 'out', pain: true, type: 'gentle' },
] as const)('$type routine removal and persistence', ({ location, pain, type }) => {
  function seedRoutine(completed?: boolean) {
    const log = seedWalk({
      appliedFixes: ['walk', 'food_order', 'swap'],
      movementType: type,
      ...(completed === undefined ? {} : {
        movementStartedAt: START - 90_000,
        movementCompleted: completed,
        ...(completed ? { movementMinutes: 1.5 } : {}),
      }),
    });
    saveMovementSettings({ pain, doctorLimit: false, location });
    return log;
  }

  function expectFreshRoutine(log: MealLog, count: string) {
    expect(saved(log)).toMatchObject({ movementType: type, walkCompleted: false });
    expect(saved(log)).not.toHaveProperty('movementStartedAt');
    expect(saved(log)).not.toHaveProperty('movementMinutes');
    expect(saved(log).movementCompleted).toBeFalsy();
    expect(screen.getByTestId(`card-movement-${type}`)).toBeInTheDocument();
    expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('button-movement-start')).toBeEnabled();
    expect(screen.queryByTestId('text-movement-timer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-movement-undo')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
  }

  it.each([false, true])('removes progress and reselects fresh after reload (completed: %s)', (completed) => {
    const log = seedRoutine();
    const otherMeals = loadLogs().filter((entry) => entry.id !== log.id);
    let view = openMeal(log);
    const count = screen.getByTestId('text-stat-walks').textContent!;
    click('button-movement-start');
    act(() => { vi.advanceTimersByTime(90_000); });
    if (completed) click('button-movement-done');
    expect(saved(log)).toMatchObject({
      movementType: type, movementStartedAt: START,
      movementCompleted: completed, walkCompleted: false,
      ...(completed ? { movementMinutes: 1.5 } : {}),
    });
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);

    // Removing the suggestion clears its type as well as its progress.
    click('button-fix-walk');
    const removed = saved(log);
    expect(removed).toEqual({
      ...log, appliedFixes: ['food_order', 'swap'], movementType: undefined,
    });
    for (const key of ['movementType', 'movementStartedAt', 'movementMinutes', 'movementCompleted']) {
      expect(removed).not.toHaveProperty(key);
    }
    expect(loadLogs().filter((entry) => entry.id !== log.id)).toEqual(otherMeals);
    expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId(`card-movement-${type}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-movement-timer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-movement-undo')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);

    view.unmount();
    vi.setSystemTime(START + TEN_MINUTES);
    view = openMeal(log);
    expect(saved(log)).toEqual(removed);
    expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId(`card-movement-${type}`)).not.toBeInTheDocument();
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
    click('button-fix-walk');
    expectFreshRoutine(log, count);
    expect(saved(log)).not.toHaveProperty('movementCompleted');
    click('button-movement-start');
    expect(saved(log)).toMatchObject({
      movementType: type, movementStartedAt: START + TEN_MINUTES, movementCompleted: false,
    });
    expect(screen.getByTestId('text-movement-timer')).toHaveTextContent(/^10:00$/);
    act(() => { vi.advanceTimersByTime(60_000); });
    click('button-movement-done');
    expect(saved(log)).toMatchObject({ movementCompleted: true, movementMinutes: 1, walkCompleted: false });
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
    view.unmount();
    openMeal(log);
    expect(screen.getByTestId('text-movement-status')).toHaveTextContent(/^1 min logged$/);
    expect(screen.getByTestId('button-movement-undo')).toBeEnabled();
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
    expect(loadLogs().filter((entry) => entry.id !== log.id)).toEqual(otherMeals);
    expect(trackSpikeEvent).not.toHaveBeenCalled();
  });

  it('Undo keeps the suggestion selected but clears completion and restarts fresh after reload', () => {
    const log = seedRoutine(true);
    const otherMeals = loadLogs().filter((entry) => entry.id !== log.id);
    const view = openMeal(log);
    const count = screen.getByTestId('text-stat-walks').textContent!;
    expect(screen.getByTestId('text-movement-status')).toHaveTextContent('1.5 min logged');
    click('button-movement-undo');
    const undone = saved(log);
    expect(undone).toEqual({
      ...log, movementCompleted: false, movementStartedAt: undefined, movementMinutes: undefined,
    });
    expectFreshRoutine(log, count);
    expect(undone.movementCompleted).toBe(false);
    view.unmount();
    vi.setSystemTime(START + TEN_MINUTES);
    openMeal(log);
    expect(saved(log)).toEqual(undone);
    expectFreshRoutine(log, count);
    click('button-movement-start');
    expect(saved(log)).toMatchObject({
      movementStartedAt: START + TEN_MINUTES, movementCompleted: false, walkCompleted: false,
    });
    expect(screen.getByTestId('text-movement-timer')).toHaveTextContent(/^10:00$/);
    expect(saved(log)).not.toHaveProperty('movementMinutes');
    act(() => { vi.advanceTimersByTime(60_000); });
    click('button-movement-done');
    expect(saved(log)).toMatchObject({ movementCompleted: true, movementMinutes: 1, walkCompleted: false });
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
    expect(loadLogs().filter((entry) => entry.id !== log.id)).toEqual(otherMeals);
    expect(trackSpikeEvent).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'remove', completed: false },
    { action: 'remove', completed: true },
    { action: 'undo', completed: true },
  ] as const)('failed $action preserves progress across reload and allows retry (completed: $completed)', ({ action, completed }) => {
    const log = seedRoutine(completed);
    let view = openMeal(log);
    const count = screen.getByTestId('text-stat-walks').textContent!;
    const raw = localStorage.getItem('spike.demo.logs.v1');
    const writes = failLogWrites(true);
    const changed = vi.fn();
    const button = action === 'remove' ? 'button-fix-walk' : 'button-movement-undo';
    window.addEventListener(LOGS_CHANGED, changed);
    const expectPriorState = () => {
      expect(localStorage.getItem('spike.demo.logs.v1')).toBe(raw);
      expect(saved(log)).toEqual(log);
      expect(screen.getByTestId(`card-movement-${type}`)).toBeInTheDocument();
      expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
      if (completed) {
        expect(screen.getByTestId('text-movement-status')).toHaveTextContent(/^1.5 min logged$/);
        expect(screen.getByTestId('button-movement-undo')).toBeEnabled();
      } else {
        expect(screen.getByTestId('text-movement-timer')).toHaveTextContent(/^8:30$/);
        expect(screen.getByTestId('button-movement-done')).toBeEnabled();
      }
    };
    try {
      click(button);
      expect(screen.getByTestId('text-save-error')).toHaveTextContent('Nothing was updated');
      expectPriorState();
      expect(changed).not.toHaveBeenCalled();
      view.unmount();
      view = openMeal(log);
      expectPriorState();
      expect(changed).not.toHaveBeenCalled();
      writes.mockRestore();
      click(button);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('text-save-error')).not.toBeInTheDocument();
      expect(saved(log)).not.toHaveProperty('movementStartedAt');
      expect(saved(log)).not.toHaveProperty('movementMinutes');
      if (action === 'undo') {
        expectFreshRoutine(log, count);
        expect(saved(log).movementCompleted).toBe(false);
      } else {
        expect(saved(log).appliedFixes).toEqual(['food_order', 'swap']);
        expect(saved(log)).not.toHaveProperty('movementType');
        expect(saved(log)).not.toHaveProperty('movementCompleted');
        expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByTestId(`card-movement-${type}`)).not.toBeInTheDocument();
      }
      expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
      expect(trackSpikeEvent).not.toHaveBeenCalled();
    } finally {
      writes.mockRestore();
      window.removeEventListener(LOGS_CHANGED, changed);
    }
  });
});

const MOVEMENT_CASES = [
  { type: 'walk', settings: { pain: false, doctorLimit: false, location: 'out' } },
  { type: 'home', settings: { pain: false, doctorLimit: false, location: 'home' } },
  { type: 'desk', settings: { pain: false, doctorLimit: false, location: 'desk' } },
  { type: 'gentle', settings: { pain: true, doctorLimit: false, location: 'out' } },
] as const;
const PROGRESS_KEYS = [
  'walkStartedAt', 'walkMinutes', 'walkViaPark',
  'movementStartedAt', 'movementCompleted', 'movementMinutes',
] as const;

function editMovementSettings(settings: MovementSettings) {
  if (!screen.queryByTestId('form-movement-settings')) click('button-movement-settings');
  click(`radio-pain-${settings.pain ? 'yes' : 'no'}`);
  click(`radio-doctor-${settings.doctorLimit ? 'yes' : 'no'}`);
  click(`radio-location-${settings.location}`);
  click('button-movement-save');
}

describe.each(MOVEMENT_CASES)('$type settings transitions', ({ type, settings }) => {
  function seedProgress(completed: boolean, demo = false) {
    const log = seedWalk({
      demo, appliedFixes: ['walk', 'food_order', 'swap'], movementType: type,
      ...(type === 'walk' ? {
        walkStartedAt: START - 90_000, walkCompleted: completed, walkViaPark: true,
        ...(completed ? { walkMinutes: 1.5 } : {}),
      } : {
        movementStartedAt: START - 90_000, movementCompleted: completed,
        ...(completed ? { movementMinutes: 1.5 } : {}),
      }),
    });
    saveMovementSettings(settings);
    return log;
  }

  function expectNoOldProgress() {
    for (const id of [
      'text-walk-timer', 'button-walk-done', 'button-walk-undo',
      'text-movement-timer', 'button-movement-done', 'button-movement-undo',
    ]) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    for (const prefix of ['walk', 'movement']) {
      const status = screen.queryByTestId(`text-${prefix}-status`);
      if (status) expect(status).not.toHaveTextContent(/logged|via a park/);
    }
  }

  it.each([false, true])('switches options and clears all progress across reload (completed: %s)', (completed) => {
    const log = seedProgress(completed);
    const otherMeals = loadLogs().filter((entry) => entry.id !== log.id);
    const target = MOVEMENT_CASES[type === 'home' ? 0 : 1];
    let view = openMeal(log);
    editMovementSettings(target.settings);
    const next = saved(log);
    expect(next).toEqual({
      ...log, movementType: target.type, walkCompleted: false,
      ...Object.fromEntries(PROGRESS_KEYS.map((key) => [key, undefined])),
    });
    expect(next.appliedFixes).toEqual(log.appliedFixes);
    for (const key of PROGRESS_KEYS) expect(next).not.toHaveProperty(key);
    expect(loadMovementSettings()).toEqual(target.settings);
    expect(screen.queryByTestId('form-movement-settings')).not.toBeInTheDocument();
    expectNoOldProgress();
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^0$/);
    view.unmount();
    vi.setSystemTime(START + 30_000);
    view = openMeal(log);
    expect(saved(log)).toEqual(next);
    expectNoOldProgress();
    if (target.type === 'walk') {
      expect(screen.getByTestId('button-find-walk')).toBeEnabled();
    } else {
      expect(screen.getByTestId(`card-movement-${target.type}`)).toBeInTheDocument();
      click('button-movement-start');
      expect(screen.getByTestId('text-movement-timer')).toHaveTextContent(/^10:00$/);
      expect(saved(log).movementStartedAt).toBe(START + 30_000);
    }
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^0$/);
    expect(loadLogs().filter((entry) => entry.id !== log.id)).toEqual(otherMeals);
    expect(events('walk_completed')).toHaveLength(0);
    expect(events('movement_completed')).toHaveLength(0);
  });

  it.each([false, true])('doctor restriction removes only movement and persists (completed: %s)', (completed) => {
    const log = seedProgress(completed);
    const view = openMeal(log);
    const restricted = { ...settings, doctorLimit: true };
    editMovementSettings(restricted);
    const next = saved(log);
    expect(next).toEqual({
      ...log, appliedFixes: ['food_order', 'swap'], movementType: undefined, walkCompleted: false,
      ...Object.fromEntries(PROGRESS_KEYS.map((key) => [key, undefined])),
    });
    expect(next).not.toHaveProperty('movementType');
    for (const key of PROGRESS_KEYS) expect(next).not.toHaveProperty(key);
    const expectRestricted = () => {
      expectNoOldProgress();
      expect(screen.getByTestId('text-doctor-note')).toHaveTextContent('Check with your doctor');
      expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'false');
      for (const option of MOVEMENT_CASES.filter((entry) => entry.type !== 'walk')) {
        expect(screen.queryByTestId(`card-movement-${option.type}`)).not.toBeInTheDocument();
      }
      expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^0$/);
    };
    expectRestricted();
    view.unmount();
    openMeal(log);
    expect(loadMovementSettings()).toEqual(restricted);
    expect(saved(log)).toEqual(next);
    // Reopened restricted meals must still explain why movement is unavailable.
    click('button-fix-walk');
    expectRestricted();
    expect(events('walk_completed')).toHaveLength(0);
    expect(events('movement_completed')).toHaveLength(0);
  });

  it('hides a movement-only reduction even when restriction cleanup cannot save', () => {
    const progress = seedProgress(true);
    const log = { ...progress, appliedFixes: ['walk'] as MealLog['appliedFixes'] };
    localStorage.setItem('spike.logs.v1', JSON.stringify([log]));
    const view = openMeal(log);
    expect(screen.getByTestId('text-reduced')).toBeInTheDocument();
    const writes = failLogWrites();
    editMovementSettings({ ...settings, doctorLimit: true });
    expect(screen.queryByTestId('text-reduced')).not.toBeInTheDocument();
    expect(saved(log)).toEqual(log);
    view.unmount();
    openMeal(log);
    expect(screen.queryByTestId('text-reduced')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-doctor-note')).toBeInTheDocument();
    writes.mockRestore();
    click('button-movement-settings');
    click('button-movement-save');
    expect(saved(log).appliedFixes).toEqual([]);
    expect(saved(log).walkCompleted).toBe(false);
    expect(screen.queryByTestId('text-reduced')).not.toBeInTheDocument();
  });

  it.each([false, true])('retains compatible progress without writing history (completed: %s)', (completed) => {
    const log = seedProgress(completed);
    const view = openMeal(log);
    const count = screen.getByTestId('text-stat-walks').textContent;
    const writes = failLogWrites();
    // A changed answer can still select the same option: pain takes priority
    // over location for gentle movement.
    const compatible = type === 'gentle' ? { ...settings, location: 'desk' as const } : settings;
    editMovementSettings(compatible);
    expect(saved(log)).toEqual(log);
    expect(loadMovementSettings()).toEqual(compatible);
    expect(screen.queryByTestId('form-movement-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('text-save-error')).not.toBeInTheDocument();
    expect(writes.mock.calls.filter(([key]) => key === 'spike.logs.v1')).toHaveLength(0);
    view.unmount();
    vi.setSystemTime(START + 30_000);
    openMeal(log);
    expect(saved(log)).toEqual(log);
    const prefix = type === 'walk' ? 'walk' : 'movement';
    if (completed) {
      expect(screen.getByTestId(`text-${prefix}-status`)).toHaveTextContent('1.5 min logged');
      expect(screen.getByTestId(`button-${prefix}-undo`)).toBeEnabled();
    } else {
      expect(screen.getByTestId(`text-${prefix}-timer`)).toHaveTextContent(/^8:00$/);
      expect(screen.getByTestId(`button-${prefix}-done`)).toBeEnabled();
    }
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
    expect(events('movement_option_shown')).toHaveLength(0);
  });

  it.each([
    { completed: false, restricted: false, demo: false },
    { completed: true, restricted: false, demo: false },
    { completed: false, restricted: true, demo: false },
    { completed: true, restricted: true, demo: false },
    { completed: false, restricted: false, demo: true },
    { completed: true, restricted: true, demo: true },
  ])('failed history write stays safe and can retry after reload ($completed, restricted: $restricted, demo: $demo)', ({ completed, restricted, demo }) => {
    const log = seedProgress(completed, demo);
    const target: MovementSettings = restricted
      ? { ...settings, doctorLimit: true }
      : MOVEMENT_CASES[type === 'home' ? 0 : 1].settings;
    let view = openMeal(log);
    const count = screen.getByTestId('text-stat-walks').textContent!;
    const key = demo ? 'spike.demo.logs.v1' : 'spike.logs.v1';
    const raw = localStorage.getItem(key);
    const writes = failLogWrites(demo);
    const changed = vi.fn();
    window.addEventListener(LOGS_CHANGED, changed);
    try {
      editMovementSettings(target);
      expect(loadMovementSettings()).toEqual(target);
      expect(localStorage.getItem(key)).toBe(raw);
      expect(saved(log)).toEqual(log);
      expect(screen.getByTestId('text-save-error')).toHaveTextContent('Movement settings saved, but meal history could not be updated');
      expect(screen.getByTestId('form-movement-settings')).toBeInTheDocument();
      expect(screen.getByTestId(`radio-doctor-${restricted ? 'yes' : 'no'}`)).toBeChecked();
      expect(screen.getByTestId(`radio-location-${target.location}`)).toBeChecked();
      expect(screen.getByTestId('radio-doctor-no')).toBeDisabled();
      expect(screen.getByTestId(`radio-location-${settings.location}`)).toBeDisabled();
      expect(screen.getByTestId('text-movement-retry')).toHaveTextContent('before changing these saved safety answers');
      expectNoOldProgress();
      expect(screen.getByTestId('button-fix-walk')).toHaveAttribute('aria-pressed', 'false');
      if (restricted) expect(screen.getByTestId('text-doctor-note')).toBeInTheDocument();
      expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
      expect(changed).not.toHaveBeenCalled();
      view.unmount();
      view = openMeal(log);
      expectNoOldProgress();
      expect(saved(log)).toEqual(log);
      expect(screen.getByTestId('text-stat-walks').textContent).toBe(count);
      click('button-movement-settings');
      expect(screen.getByTestId('radio-doctor-no')).toBeDisabled();
      expect(screen.getByTestId(`radio-location-${settings.location}`)).toBeDisabled();
      writes.mockRestore();
      click('button-movement-save');
      expect(changed).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('text-save-error')).not.toBeInTheDocument();
      expect(screen.queryByTestId('form-movement-settings')).not.toBeInTheDocument();
      const next = saved(log);
      expect(next.walkCompleted).toBe(false);
      for (const field of PROGRESS_KEYS) expect(next).not.toHaveProperty(field);
      expect(next.appliedFixes).toEqual(restricted ? ['food_order', 'swap'] : log.appliedFixes);
      const expectedCount = Number(count) - Number(type === 'walk' && completed);
      expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(expectedCount));
      view.unmount();
      openMeal(log);
      expect(saved(log)).toEqual(next);
      expectNoOldProgress();
      expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(expectedCount));
      expect(events('walk_completed')).toHaveLength(0);
      expect(events('movement_completed')).toHaveLength(0);
      if (demo) expect(trackSpikeEvent).not.toHaveBeenCalled();
    } finally {
      writes.mockRestore();
      window.removeEventListener(LOGS_CHANGED, changed);
    }
  });
});

describe('walk timer and Home persistence callbacks', () => {
  it('persists Start and restores the elapsed countdown after a reload', async () => {
    const log = seedWalk();
    const first = openMeal(log);
    const initialCount = screen.getByTestId('text-stat-walks').textContent;
    await startWalk();
    expect(saved(log)).toMatchObject({ walkStartedAt: START, walkViaPark: true, walkCompleted: false });
    expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('10:00');
    expect(screen.getByTestId('text-stat-walks').textContent).toBe(initialCount);

    act(() => { vi.advanceTimersByTime(90_000); });
    expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('8:30');
    first.unmount(); // A fresh Home must read storage, not retain React state.
    vi.setSystemTime(START + 120_000);
    openMeal(log);
    expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('8:00');
    expect(saved(log).walkStartedAt).toBe(START);
    expect(trackSpikeEvent).not.toHaveBeenCalled(); // Demo start and Week are silent.
  });

  it('catches up on visibilitychange without interval ticks and never auto-completes at zero', () => {
    const log = seedWalk({ demo: false, walkStartedAt: START });
    const view = openMeal(log);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    act(() => {
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      // setSystemTime deliberately does not run timers: model a suspended tab.
      vi.setSystemTime(START + 245_000);
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('5:55');
    act(() => {
      vi.setSystemTime(START + TEN_MINUTES + 30_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('0:00');
    expect(screen.getByTestId('text-walk-status')).toHaveTextContent('Tap Done');
    expect(saved(log).walkCompleted).toBe(false);
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^0$/);
    expect(events('walk_completed')).toHaveLength(0);
    view.unmount();
    openMeal(log);
    expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('0:00');
    expect(screen.getByTestId('button-walk-done')).toBeEnabled();
    expect(saved(log).walkCompleted).toBe(false);
  });

  it('Done saves and emits once, updates Week, and remains completed after reload', () => {
    const log = seedWalk({ demo: false, walkStartedAt: START - TEN_MINUTES, walkViaPark: true });
    const view = openMeal(log);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const changed = vi.fn();
    window.addEventListener(LOGS_CHANGED, changed);
    try {
      const done = screen.getByTestId('button-walk-done');
      fireEvent.click(done);
      fireEvent.click(done); // Stale button / repeated user action cannot save twice.
      expect(writes.mock.calls.filter(([key]) => key === 'spike.logs.v1')).toHaveLength(1);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(saved(log)).toMatchObject({ walkCompleted: true, walkMinutes: 10, walkViaPark: true });
      expect(loadLogs()).toHaveLength(1);
      expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^1$/);
      expect(screen.queryByTestId('button-walk-done')).not.toBeInTheDocument();
      expect(events('walk_completed')).toHaveLength(1);
      expect(events('walk_completed')[0]).toMatchObject({ minutes: 10, via_park: true });
      view.unmount();
      openMeal(log);
      expect(screen.getByTestId('text-walk-status')).toHaveTextContent('10 min logged · via a park');
      expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^1$/);
      expect(events('walk_completed')).toHaveLength(1);
    } finally {
      window.removeEventListener(LOGS_CHANGED, changed);
    }
  });

  it('allows explicit early completion and records elapsed time rather than ten minutes', () => {
    const log = seedWalk({ demo: false, walkStartedAt: START - 90_000 });
    openMeal(log);
    click('button-walk-done');
    expect(saved(log)).toMatchObject({ walkCompleted: true, walkMinutes: 1.5 });
    expect(events('walk_completed')[0]).toMatchObject({ minutes: 1.5, via_park: false });
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^1$/);
  });

  it('does not complete or emit on failed storage writes and can retry once', () => {
    const log = seedWalk({ demo: false, walkStartedAt: START - TEN_MINUTES });
    openMeal(log);
    const writes = failLogWrites();
    const changed = vi.fn();
    window.addEventListener(LOGS_CHANGED, changed);
    try {
      click('button-walk-done');
      expect(screen.getByTestId('text-save-error')).toHaveTextContent('Nothing was updated');
      expect(saved(log).walkCompleted).toBe(false);
      expect(screen.getByTestId('button-walk-done')).toBeEnabled();
      expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^0$/);
      expect(events('walk_completed')).toHaveLength(0);
      expect(changed).not.toHaveBeenCalled();
      writes.mockRestore();
      click('button-walk-done');
      expect(saved(log).walkCompleted).toBe(true);
      expect(events('walk_completed')).toHaveLength(1);
      expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^1$/);
      expect(screen.queryByTestId('text-save-error')).not.toBeInTheDocument();
    } finally {
      window.removeEventListener(LOGS_CHANGED, changed);
    }
  });

  it('does not start or emit walk_started when the start timestamp cannot be saved', async () => {
    const log = seedWalk({ demo: false });
    openMeal(log);
    const writes = failLogWrites();
    await startWalk();
    expect(saved(log).walkStartedAt).toBeUndefined();
    expect(screen.queryByTestId('text-walk-timer')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-save-error')).toBeInTheDocument();
    expect(events('walk_started')).toHaveLength(0);
    writes.mockRestore();
    click('button-walk-start');
    expect(saved(log).walkStartedAt).toBe(START);
    expect(events('walk_started')).toHaveLength(1);
  });

  it('Undo clears completion and all timer fields, decrements Week and restarts at ten minutes', async () => {
    const log = seedWalk({ walkStartedAt: START - TEN_MINUTES, walkViaPark: true });
    const view = openMeal(log);
    const baseline = Number(screen.getByTestId('text-stat-walks').textContent);
    click('button-walk-done');
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(baseline + 1));
    click('button-walk-undo');
    expect(saved(log)).toMatchObject({ walkCompleted: false, appliedFixes: ['walk'] });
    for (const key of ['walkStartedAt', 'walkMinutes', 'walkViaPark']) {
      expect(saved(log)).not.toHaveProperty(key);
    }
    expect(screen.queryByTestId('text-walk-timer')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(String(baseline));
    view.unmount();
    vi.setSystemTime(START + 60_000);
    openMeal(log);
    expect(screen.queryByTestId('text-walk-timer')).not.toBeInTheDocument();
    await startWalk();
    expect(screen.getByTestId('text-walk-timer')).toHaveTextContent('10:00');
    expect(saved(log).walkStartedAt).toBe(START + 60_000);
    expect(trackSpikeEvent).not.toHaveBeenCalled();
  });

  it('keeps a completed walk and Week unchanged if Undo cannot be saved', () => {
    const log = seedWalk({
      demo: false, walkCompleted: true, walkStartedAt: START - TEN_MINUTES,
      walkMinutes: 10, walkViaPark: true,
    });
    openMeal(log);
    failLogWrites();
    click('button-walk-undo');
    expect(saved(log)).toEqual(log);
    expect(screen.getByTestId('button-walk-undo')).toBeEnabled();
    expect(screen.getByTestId('text-save-error')).toBeInTheDocument();
    expect(screen.getByTestId('text-stat-walks')).toHaveTextContent(/^1$/);
    expect(events('walk_completed')).toHaveLength(0);
  });
});
