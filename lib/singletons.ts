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
  var __dashboardBootPromise: Promise<void> | undefined;
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

async function _boot(): Promise<void> {
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
}

export function ensureBoot(): Promise<void> {
  if (!globalThis.__dashboardBootPromise) {
    globalThis.__dashboardBootPromise = _boot();
  }
  // All concurrent callers await the same Promise; none proceeds until boot
  // completes, eliminating the TOCTOU race where a second request would see
  // the old boolean flag as true while async init was still in flight.
  return globalThis.__dashboardBootPromise;
}
