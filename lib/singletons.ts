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
  var __dashboardBooted: boolean | undefined;
}

const MIN_MSGS_FOR_SUMMARY = 5;
const summarizing = new Set<string>();
let activeSummaries = 0;

function summaryCap(): number {
  const v = (getDb().prepare("SELECT value FROM settings WHERE key='concurrency_caps'").get() as any)?.value
           ?? '{"watchers":3,"summaries":2}';
  return (JSON.parse(v) as { watchers: number; summaries: number }).summaries ?? 2;
}

async function maybeAutoSummarize(sessionId: string) {
  if (summarizing.has(sessionId)) return;
  if (activeSummaries >= summaryCap()) return;
  const db = getDb();
  const s = db.prepare("SELECT msg_count FROM sessions WHERE id=?").get(sessionId) as any;
  if (!s || s.msg_count < MIN_MSGS_FOR_SUMMARY) return;
  const existing = db.prepare("SELECT session_id FROM summaries WHERE session_id=?").get(sessionId);
  if (existing) return;
  summarizing.add(sessionId);
  activeSummaries++;
  try { await summarizeSession(sessionId); }
  catch { /* surface via feed already */ }
  finally { summarizing.delete(sessionId); activeSummaries--; }
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

  const autoSummarize = debounce((sid: string) => { maybeAutoSummarize(sid).catch(() => {}); }, 30_000);

  bus.on("session:msg", (d: any) => { recomputeForSession(d.sessionId); autoSummarize(d.sessionId); });
  bus.on("session:new", (d: any) => { recomputeForSession(d.sessionId); autoSummarize(d.sessionId); });
}
