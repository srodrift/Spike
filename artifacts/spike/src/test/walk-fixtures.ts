import { clearDemoData, loadDemoWeek, loadLogs, upsertLog, type MealLog } from '@/lib/spike';

/** Use the product's own demo meals, never AI requests or a user's history. */
export function seedWalk({ demo = true, ...patch }: Partial<MealLog> = {}): MealLog {
  loadDemoWeek();
  const sample = loadLogs().findLast((log) => !log.walkCompleted)!;
  const log: MealLog = {
    ...sample,
    appliedFixes: ['walk'],
    demo,
    walkCompleted: false,
    ...patch,
  };
  if (!demo) clearDemoData();
  upsertLog(log);
  return log;
}
