import type { MealLog } from '@/lib/spike';

export const PERSONAL_KEY = 'spike.logs.v1';
export const DEMO_KEY = 'spike.demo.logs.v1';
export const ACTIVE_KEY = 'spike.demo.active';

export function meal(id: string, demo = false): MealLog {
  return {
    id,
    date: '2026-11-06T12:00:00.000Z',
    input: 'text',
    demo,
    estimate: {
      name: id,
      foods: [{ name: id, portion: '1 serving', calories: 400 }],
      calories: 400,
      glycemic_level: 'Medium',
      reason: 'An illustrative test meal.',
      swaps: [],
    },
    appliedFixes: [],
    walkCompleted: false,
  };
}

export function seedHistories(activeDemo = false) {
  const personal = [meal('personal-one'), meal('personal-two')];
  const demo = [meal('demo-one', true), meal('demo-two', true)];
  localStorage.setItem(PERSONAL_KEY, JSON.stringify(personal));
  localStorage.setItem(DEMO_KEY, JSON.stringify(demo));
  if (activeDemo) localStorage.setItem(ACTIVE_KEY, 'true');
  return { personal, demo, personalRaw: localStorage.getItem(PERSONAL_KEY) };
}
