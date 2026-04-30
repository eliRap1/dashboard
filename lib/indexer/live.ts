import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { sessionsDir } from "@/lib/paths";
import { bus } from "@/lib/bus";

let timer: NodeJS.Timeout | null = null;

export async function syncLiveOnce(): Promise<void> {
  const db = getDb();
  const dir = sessionsDir();
  let entries: string[] = [];
  try { entries = (await fs.readdir(dir)).filter(f => f.endsWith(".json")); } catch { entries = []; }

  const seen = new Set<number>();
  const upsert = db.prepare(`
    INSERT INTO live_sessions(pid, session_id, cwd, status, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(pid) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
  `);
  for (const f of entries) {
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf8");
      const j = JSON.parse(raw);
      if (!j.pid || !j.sessionId) continue;
      seen.add(j.pid);
      upsert.run(j.pid, j.sessionId, j.cwd, j.status ?? null, j.updatedAt ?? Date.now());
    } catch { /* skip */ }
  }

  const existing = db.prepare("SELECT pid FROM live_sessions").all() as { pid: number }[];
  const remove = db.prepare("DELETE FROM live_sessions WHERE pid = ?");
  for (const e of existing) {
    if (!seen.has(e.pid)) {
      remove.run(e.pid);
      bus.emit("live:gone", { pid: e.pid });
    }
  }
  bus.emit("live:change", { count: seen.size });
}

export function startLivePolling(intervalMs = 2000) {
  if (timer) return;
  syncLiveOnce().catch(() => {});
  timer = setInterval(() => { syncLiveOnce().catch(() => {}); }, intervalMs);
}

export function stopLivePolling() {
  if (timer) { clearInterval(timer); timer = null; }
}
