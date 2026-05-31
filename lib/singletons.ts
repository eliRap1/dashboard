import { getDb } from "@/lib/db";
import { scanAll } from "@/lib/indexer/scan";
import { startLivePolling } from "@/lib/indexer/live";
import { startFsWatcher } from "@/lib/watcher/fs";
import { reloadAllCronWatchers } from "@/lib/scheduler/cron";
import { startEventRouter } from "@/lib/scheduler/events";
import { bus } from "@/lib/bus";
import { recomputeProjectHealth, recomputeSessionHealth } from "@/lib/health/recompute";
import { summarizeSession } from "@/lib/ai/summarize";

declare global {
  // eslint-disable-next-line no-var
  var __dashboardBooted: boolean | undefined;
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

export async function ensureBoot(): Promise<void> {
  if (globalThis.__dashboardBooted) return;
  globalThis.__dashboardBooted = true;
  getDb();
  await scanAll();
  startLivePolling(2000);
  await startFsWatcher();
  startEventRouter();
  reloadAllCronWatchers();

  const recomputeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const summarizeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleRecompute(sid: string) {
    clearTimeout(recomputeTimers.get(sid));
    recomputeTimers.set(sid, setTimeout(() => {
      recomputeTimers.delete(sid);
      try {
        recomputeSessionHealth(sid);
        const row = getDb().prepare("SELECT project_id FROM sessions WHERE id=?").get(sid) as any;
        if (row) recomputeProjectHealth(row.project_id);
      } catch { /* ignore */ }
    }, 5000));
  }

  function scheduleSummarize(sid: string) {
    clearTimeout(summarizeTimers.get(sid));
    summarizeTimers.set(sid, setTimeout(() => {
      summarizeTimers.delete(sid);
      maybeAutoSummarize(sid).catch(() => {});
    }, 30_000));
  }

  bus.on("session:msg", (d: any) => { scheduleRecompute(d.sessionId); scheduleSummarize(d.sessionId); });
  bus.on("session:new", (d: any) => { scheduleRecompute(d.sessionId); scheduleSummarize(d.sessionId); });
}
