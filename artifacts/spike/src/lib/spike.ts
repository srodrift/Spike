import { trackSpikeEvent, type AnalyticsInput, type MealEstimate } from '@workspace/api-client-react';

export type InputKind = 'photo' | 'voice' | 'text';
export type Level = 'Low' | 'Medium' | 'High';
export type FixType = 'walk' | 'food_order' | 'swap';

export interface MealLog {
  id: string;
  date: string; // ISO timestamp
  input: InputKind;
  estimate: MealEstimate;
  appliedFixes: FixType[];
  walkCompleted: boolean;
  demo?: boolean;
}

const LOGS_KEY = 'spike.logs.v1';
const DEMO_KEY = 'spike.demo.logs.v1';
const DEMO_ACTIVE = 'spike.demo.active';
export const LOGS_CHANGED = 'spike-logs-changed';

export function demoLoaded(): boolean {
  try { return localStorage.getItem(DEMO_ACTIVE) === 'true'; } catch { return false; }
}

function notifyLogsChanged() {
  window.dispatchEvent(new Event(LOGS_CHANGED));
}

export function clearDemoData(): void {
  localStorage.removeItem(DEMO_ACTIVE);
  localStorage.removeItem(DEMO_KEY);
  notifyLogsChanged();
}

export function loadDemoWeek(): void {
  const samples: { name: string; level: Level; swap: string }[] = [
    { name: 'Pepperoni pizza and cola', level: 'High', swap: 'Swap cola for sparkling water' },
    { name: 'Burrito bowl with white rice', level: 'High', swap: 'Swap half the rice for vegetables' },
    { name: 'Oatmeal with banana', level: 'Medium', swap: 'Swap honey for a few walnuts' },
    { name: 'Greek yogurt with berries', level: 'Low', swap: 'Choose unsweetened Greek yogurt' },
    { name: 'Turkey sandwich on wholegrain bread', level: 'Medium', swap: 'Add cucumber and leafy greens' },
    { name: 'Ramen with egg', level: 'High', swap: 'Swap some noodles for mushrooms' },
    { name: 'Lentil soup with sourdough', level: 'Medium', swap: 'Swap half the bread for a side salad' },
    { name: 'Salad with grilled chicken', level: 'Low', swap: 'Swap sweet dressing for olive oil and lemon' },
    { name: 'Pastry and sweetened latte', level: 'High', swap: 'Swap the sweetened latte for an unsweetened latte' },
    { name: 'Salmon with roasted sweet potato', level: 'Medium', swap: 'Swap some potato for green beans' },
    { name: 'Veggie omelet with avocado', level: 'Low', swap: 'Swap ketchup for fresh tomatoes' },
    { name: 'Spaghetti with garlic bread', level: 'High', swap: 'Swap garlic bread for roasted vegetables' },
    { name: 'Chicken tacos with black beans', level: 'Medium', swap: 'Swap one tortilla for a lettuce wrap' },
    { name: 'Quinoa bowl with chickpeas', level: 'Medium', swap: 'Swap sweet sauce for lemon and herbs' },
  ];
  const walked = new Set([0, 1, 2, 5, 8, 11]);
  const fixed = new Set([0, 1, 5, 8]);
  const logs: MealLog[] = samples.map((sample, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - Math.floor(index / 2)));
    date.setHours(index % 2 === 0 ? 8 : 12, 0, 0, 0);
    return {
      id: `demo-${localDateKey(date)}-${index}`,
      date: date.toISOString(),
      input: index % 3 === 0 ? 'photo' : 'text',
      demo: true,
      estimate: {
        name: sample.name,
        foods: sample.name.split(/ with | and /).map((name) => ({ name, portion: '1 typical serving' })),
        glycemic_level: sample.level,
        reason: sample.level === 'High'
          ? 'A larger portion of refined carbohydrates or added sugar may produce a sharper rise.'
          : sample.level === 'Medium'
            ? 'Carbohydrates are balanced with some fiber, fat or protein.'
            : 'Protein, vegetables and fiber keep the carbohydrate load relatively modest.',
        swaps: [sample.swap],
      },
      appliedFixes: fixed.has(index) ? ['walk'] : [],
      walkCompleted: walked.has(index),
    };
  });
  // Separate keys preserve real history without overwriting or mixing it with demo records.
  localStorage.setItem(DEMO_KEY, JSON.stringify(logs));
  localStorage.setItem(DEMO_ACTIVE, 'true');
  notifyLogsChanged();
}
const UID_KEY = 'spike.distinctId';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export const newId = uuid;

let memoryUid: string | null = null;
export function getDistinctId(): string {
  try {
    let id = localStorage.getItem(UID_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(UID_KEY, id);
    }
    return id;
  } catch {
    if (!memoryUid) memoryUid = uuid();
    return memoryUid;
  }
}

export function loadLogs(): MealLog[] {
  const raw = localStorage.getItem(demoLoaded() ? DEMO_KEY : LOGS_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as MealLog[]) : [];
}

/** Throws on failure — callers must surface errors. */
export function upsertLog(log: MealLog): void {
  const key = log.demo ? DEMO_KEY : LOGS_KEY;
  const logs: MealLog[] = JSON.parse(localStorage.getItem(key) || '[]');
  const i = logs.findIndex((l) => l.id === log.id);
  if (i >= 0) logs[i] = log;
  else logs.unshift(log);
  localStorage.setItem(key, JSON.stringify(logs));
  const check = (JSON.parse(localStorage.getItem(key) || '[]') as MealLog[]).find((l) => l.id === log.id);
  if (!check) throw new Error('Save could not be verified');
  if (!log.demo) localStorage.removeItem(DEMO_ACTIVE);
  notifyLogsChanged();
}

export function deleteLog(id: string): void {
  const logs = loadLogs().filter((l) => l.id !== id);
  localStorage.setItem(demoLoaded() ? DEMO_KEY : LOGS_KEY, JSON.stringify(logs));
  notifyLogsChanged();
}

type EventPayload = Omit<AnalyticsInput, 'distinctId'>;
/** Fire-and-forget analytics via the server relay. Only whitelisted fields. */
export function track(p: EventPayload): void {
  if (demoLoaded()) return;
  const data: AnalyticsInput = { event: p.event, distinctId: getDistinctId() };
  if (p.input) data.input = p.input;
  if (typeof p.count === 'number') data.count = p.count;
  if (p.level) data.level = p.level;
  if (p.fix_type) data.fix_type = p.fix_type;
  if (p.from) data.from = p.from;
  if (p.to) data.to = p.to;
  if (p.source) data.source = p.source;
  trackSpikeEvent(data).catch(() => undefined);
}

export function stepDown(l: Level): Level {
  return l === 'High' ? 'Medium' : 'Low';
}

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function compressImage(file: File, maxEdge = 1024): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That file could not be read as an image.'));
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is not available in this browser.');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const LEVEL_STYLE: Record<Level, { color: string; soft: string; word: string }> = {
  Low: { color: 'hsl(170 40% 36%)', soft: 'hsl(168 32% 88%)', word: 'a gentle rise' },
  Medium: { color: 'hsl(36 88% 48%)', soft: 'hsl(46 92% 86%)', word: 'a moderate rise' },
  High: { color: 'hsl(12 82% 56%)', soft: 'hsl(14 85% 90%)', word: 'a sharper rise' },
};
