import { clearDemoData, loadDemoWeek, loadLogs, upsertLog, type MealLog } from '@/lib/spike';
import { saveMovementSettings } from '@/lib/movement';

/** Use the product's own demo meals, never AI requests or a user's history. */
export function seedWalk({ demo = true, ...patch }: Partial<MealLog> = {}): MealLog {
  // Reopened walk plans require a saved, compatible movement safety check.
  saveMovementSettings({ pain: false, doctorLimit: false, location: 'out' });
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
