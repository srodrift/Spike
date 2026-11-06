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
}

const LOGS_KEY = 'spike.logs.v1';
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
  const raw = localStorage.getItem(LOGS_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as MealLog[]) : [];
}

/** Throws on failure — callers must surface errors. */
export function upsertLog(log: MealLog): void {
  const logs = loadLogs();
  const i = logs.findIndex((l) => l.id === log.id);
  if (i >= 0) logs[i] = log;
  else logs.unshift(log);
  localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
  const check = loadLogs().find((l) => l.id === log.id);
  if (!check) throw new Error('Save could not be verified');
}

export function deleteLog(id: string): void {
  const logs = loadLogs().filter((l) => l.id !== id);
  localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
}

type EventPayload = Omit<AnalyticsInput, 'distinctId'>;
/** Fire-and-forget analytics via the server relay. Only whitelisted fields. */
export function track(p: EventPayload): void {
  const data: AnalyticsInput = { event: p.event, distinctId: getDistinctId() };
  if (p.input) data.input = p.input;
  if (typeof p.count === 'number') data.count = p.count;
  if (p.level) data.level = p.level;
  if (p.fix_type) data.fix_type = p.fix_type;
  if (p.from) data.from = p.from;
  if (p.to) data.to = p.to;
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
