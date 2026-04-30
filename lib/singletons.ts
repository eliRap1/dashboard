import { getDb } from "@/lib/db";
import { scanAll } from "@/lib/indexer/scan";
import { startLivePolling } from "@/lib/indexer/live";
import { startFsWatcher } from "@/lib/watcher/fs";
import { reloadAllCronWatchers } from "@/lib/scheduler/cron";
import { startEventRouter } from "@/lib/scheduler/events";
import { bus } from "@/lib/bus";
import { recomputeProjectHealth, recomputeSessionHealth } from "@/lib/health/recompute";
import { debounce } from "@/lib/watcher/debounce";

declare global {
  // eslint-disable-next-line no-var
  var __dashboardBooted: boolean | undefined;
}

export async function ensureBoot(): Promise<void> {
  if (globalThis.__dashboardBooted) return;
  globalThis.__dashboardBooted = true;
  getDb();
  await scanAll();
  startLivePolling(2000);
  await startFsWatcher();
  startEventRouter();
  reloadAllCronWatchers();

  const recomputeForSession = debounce((sid: string) => {
    try {
      recomputeSessionHealth(sid);
      const row = getDb().prepare("SELECT project_id FROM sessions WHERE id=?").get(sid) as any;
      if (row) recomputeProjectHealth(row.project_id);
    } catch { /* ignore */ }
  }, 5000);
  bus.on("session:msg", (d: any) => recomputeForSession(d.sessionId));
  bus.on("session:new", (d: any) => recomputeForSession(d.sessionId));
}
