import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackSpikeEvent } from '@workspace/api-client-react';
import {
  clearDemoData, deleteLog, demoLoaded, loadDemoWeek, loadLogs,
  LOGS_CHANGED, track, upsertLog,
} from './spike';
import { ACTIVE_KEY, DEMO_KEY, PERSONAL_KEY, meal, seedHistories } from '@/test/meal-fixtures';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T15:00:00Z'));
});

describe('separate personal and demo meal histories', () => {
  it('loads only the selected history, including an empty demo store', () => {
    const { personal, demo } = seedHistories();
    expect(loadLogs()).toEqual(personal);
    localStorage.setItem(ACTIVE_KEY, 'true');
    expect(loadLogs()).toEqual(demo);
    localStorage.removeItem(DEMO_KEY);
    expect(loadLogs()).toEqual([]);
    expect(demoLoaded()).toBe(true);
  });

  it('loads a fresh demo week, edits and deletes demo meals, then restores personal bytes', () => {
    const { personal, personalRaw } = seedHistories();
    const changed = vi.fn();
    window.addEventListener(LOGS_CHANGED, changed);
    try {
      loadDemoWeek();
      expect(demoLoaded()).toBe(true);
      const generated = loadLogs();
      expect(generated).toHaveLength(14);
      expect(generated.every((log) => log.demo)).toBe(true);
      expect(new Set(generated.map((log) => log.id)).size).toBe(14);
      expect(changed).toHaveBeenCalledTimes(1);

      const edited = { ...generated[0]!, walkCompleted: true, walkMinutes: 12 };
      upsertLog(edited);
      expect(loadLogs().find((log) => log.id === edited.id)).toEqual(edited);
      expect(loadLogs()).toHaveLength(14);
      deleteLog(generated[1]!.id);
      expect(loadLogs()).toHaveLength(13);
      expect(loadLogs().some((log) => log.id === generated[1]!.id)).toBe(false);
      expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
      track({ event: 'meal_logged', input: 'text' });
      expect(trackSpikeEvent).not.toHaveBeenCalled();

      clearDemoData();
      expect(demoLoaded()).toBe(false);
      expect(localStorage.getItem(DEMO_KEY)).toBeNull();
      expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
      expect(loadLogs()).toEqual(personal);
      expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
      expect(changed).toHaveBeenCalledTimes(4);
      track({ event: 'meal_logged', input: 'text' });
      expect(trackSpikeEvent).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(LOGS_CHANGED, changed);
    }
  });

  it('updates personal meals without duplicates and deletes only from personal history', () => {
    const { personal, demo } = seedHistories();
    const edited = { ...personal[0]!, walkCompleted: true };
    upsertLog(edited);
    expect(loadLogs()).toEqual([edited, personal[1]]);
    upsertLog(meal('new-personal'));
    expect(loadLogs().map((log) => log.id)).toEqual(['new-personal', edited.id, personal[1]!.id]);
    deleteLog(edited.id);
    expect(loadLogs().map((log) => log.id)).toEqual(['new-personal', personal[1]!.id]);
    expect(JSON.parse(localStorage.getItem(DEMO_KEY)!)).toEqual(demo);
  });

  it('a new personal meal exits demo only after saving, without copying demo meals', () => {
    const { personal, demo } = seedHistories(true);
    const added = meal('new-personal');
    upsertLog(added);
    expect(demoLoaded()).toBe(false);
    expect(loadLogs()).toEqual([added, ...personal]);
    expect(JSON.parse(localStorage.getItem(DEMO_KEY)!)).toEqual(demo);
  });

  it('edits a demo record by its ownership even while personal history is selected', () => {
    const { personal, demo } = seedHistories();
    const edited = { ...demo[0]!, walkCompleted: true };
    upsertLog(edited);
    expect(demoLoaded()).toBe(false);
    expect(loadLogs()).toEqual(personal);
    expect(JSON.parse(localStorage.getItem(DEMO_KEY)!)).toEqual([edited, demo[1]]);
  });

  it('reloading demo replaces demo edits, never personal history', () => {
    const { personalRaw } = seedHistories(true);
    loadDemoWeek();
    const original = loadLogs();
    deleteLog(original[0]!.id);
    upsertLog(meal('extra-demo', true));
    loadDemoWeek();
    expect(loadLogs()).toEqual(original);
    clearDemoData();
    clearDemoData();
    expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
    expect(demoLoaded()).toBe(false);
  });
});

describe('storage failures do not silently select another history', () => {
  it.each([DEMO_KEY, ACTIVE_KEY])('failed demo load at %s preserves personal selection', (failedKey) => {
    const { personal, personalRaw } = seedHistories();
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === failedKey) throw new Error('Storage blocked');
      set.call(this, key, value);
    });
    expect(loadDemoWeek).toThrow('Storage blocked');
    expect(demoLoaded()).toBe(false);
    expect(loadLogs()).toEqual(personal);
    expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
  });

  it.each([DEMO_KEY, ACTIVE_KEY])('failed clear at %s keeps demo selected and intact', (failedKey) => {
    const { demo, personalRaw } = seedHistories(true);
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === failedKey) throw new Error('Storage blocked');
      remove.call(this, key);
    });
    expect(clearDemoData).toThrow('Storage blocked');
    expect(demoLoaded()).toBe(true);
    expect(loadLogs()).toEqual(demo);
    expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
  });

  it.each([false, true])('failed edits and deletes preserve both stores (demo=%s)', (activeDemo) => {
    const { personal, demo, personalRaw } = seedHistories(activeDemo);
    const demoRaw = localStorage.getItem(DEMO_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    expect(() => upsertLog({ ...(activeDemo ? demo : personal)[0]!, walkCompleted: true })).toThrow('Full');
    expect(() => deleteLog((activeDemo ? demo : personal)[0]!.id)).toThrow('Full');
    expect(() => upsertLog(meal('new-personal'))).toThrow('Full');
    expect(demoLoaded()).toBe(activeDemo);
    expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
    expect(localStorage.getItem(DEMO_KEY)).toBe(demoRaw);
  });

  it('does not deactivate demo if a personal save cannot be verified', () => {
    const { demo } = seedHistories(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    expect(() => upsertLog(meal('not-saved'))).toThrow('Save could not be verified');
    expect(demoLoaded()).toBe(true);
    expect(loadLogs()).toEqual(demo);
  });

  it('surfaces unreadable mode storage instead of reading or deleting personal meals', () => {
    const { personalRaw } = seedHistories(true);
    const get = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === ACTIVE_KEY) throw new Error('Mode unavailable');
      return get.call(this, key);
    });
    expect(loadLogs).toThrow('Mode unavailable');
    expect(() => deleteLog('personal-one')).toThrow('Mode unavailable');
    expect(localStorage.getItem(PERSONAL_KEY)).toBe(personalRaw);
  });

  it.each([PERSONAL_KEY, DEMO_KEY])('reports corrupt active history at %s without overwriting it', (key) => {
    seedHistories(key === DEMO_KEY);
    localStorage.setItem(key, '{broken');
    expect(loadLogs).toThrow();
    expect(() => deleteLog('anything')).toThrow();
    expect(localStorage.getItem(key)).toBe('{broken');
    expect(demoLoaded()).toBe(key === DEMO_KEY);
  });
});
