import { getDb } from "@/lib/db";
import { scanAll } from "@/lib/indexer/scan";
import { startLivePolling } from "@/lib/indexer/live";
import { startFsWatcher } from "@/lib/watcher/fs";
import { reloadAllCronWatchers } from "@/lib/scheduler/cron";
import { startEventRouter } from "@/lib/scheduler/events";
import { bus } from "@/lib/bus";
import { recomputeProjectHealth, recomputeSessionHealth } from "@/lib/health/recompute";
import { debounce } from "@/lib/watcher/debounce";
import { summarizeSession } from "@/lib/ai/summarize";

declare global {
  // eslint-disable-next-line no-var
  var __dashboardBoot: Promise<void> | undefined;
}

const MIN_MSGS_FOR_SUMMARY = 5;
const summarizing = new Set<string>();

async function maybeAutoSummarize(sessionId: string) {
  if (summarizing.has(sessionId)) return;
  const db = getDb();
  const s = db.prepare("SELECT msg_count FROM sessions WHERE id=?").get(sessionId) as any;
  if (!s || s.msg_count < MIN_MSGS_FOR_SUMMARY) return;
  const existing = db.prepare("SELECT session_id FROM summaries WHERE session_id=?").get(sessionId);
  if (existing) return;
  summarizing.add(sessionId);
  try { await summarizeSession(sessionId); }
  catch { /* surface via feed already */ }
  finally { summarizing.delete(sessionId); }
}

// Stores the in-flight (or completed) boot promise so concurrent callers
// all await the same work rather than running initialization twice.
export function ensureBoot(): Promise<void> {
  if (globalThis.__dashboardBoot) return globalThis.__dashboardBoot;
  globalThis.__dashboardBoot = (async () => {
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

    const autoSummarize = debounce((sid: string) => { maybeAutoSummarize(sid).catch(() => {}); }, 30_000);

    bus.on("session:msg", (d: any) => { recomputeForSession(d.sessionId); autoSummarize(d.sessionId); });
    bus.on("session:new", (d: any) => { recomputeForSession(d.sessionId); autoSummarize(d.sessionId); });
  })();
  return globalThis.__dashboardBoot;
}
