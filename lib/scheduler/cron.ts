import cron, { ScheduledTask } from "node-cron";
import { runWatcher } from "@/lib/scheduler/runner";
import { getDb } from "@/lib/db";

const jobs = new Map<number, ScheduledTask>();

export function registerCronWatcher(w: { id: number; trigger_kind: string; trigger_value: string; enabled: number }) {
  jobs.get(w.id)?.stop();
  if (w.trigger_kind !== "cron" || !w.enabled) return;
  if (!cron.validate(w.trigger_value)) return;
  const t = cron.schedule(w.trigger_value, () => { runWatcher(w.id).catch(() => {}); });
  jobs.set(w.id, t);
}

export function unregisterCron(id: number) {
  jobs.get(id)?.stop();
  jobs.delete(id);
}

export function reloadAllCronWatchers() {
  for (const t of jobs.values()) t.stop();
  jobs.clear();
  const all = getDb().prepare("SELECT id, trigger_kind, trigger_value, enabled FROM watchers WHERE trigger_kind='cron'").all() as any[];
  all.forEach(registerCronWatcher);
}
