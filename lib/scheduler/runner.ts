import { getDb } from "@/lib/db";
import { runClaude } from "@/lib/ai/runClaude";
import { bus } from "@/lib/bus";
import { postWebhook } from "@/lib/notify/webhook";

export type RunOpts = { bin?: string; args?: string[]; timeoutMs?: number };

let activeWatchers = 0;
function caps() {
  const v = (getDb().prepare("SELECT value FROM settings WHERE key='concurrency_caps'").get() as any)?.value
         ?? '{"watchers":3,"summaries":2}';
  return JSON.parse(v) as { watchers: number; summaries: number };
}

function targetCwd(scope: string, targetId: string | null): string {
  const db = getDb();
  if (scope === "project") return (db.prepare("SELECT cwd FROM projects WHERE id=?").get(targetId) as any)?.cwd ?? process.cwd();
  if (scope === "session") return (db.prepare("SELECT p.cwd FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?").get(targetId) as any)?.cwd ?? process.cwd();
  return process.cwd();
}

export async function runWatcher(watcherId: number, opts: RunOpts = {}, ctx?: any): Promise<void> {
  const db = getDb();
  const w = db.prepare("SELECT * FROM watchers WHERE id=?").get(watcherId) as any;
  if (!w || !w.enabled) return;
  if (activeWatchers >= caps().watchers) {
    bus.emit("feed:new", { kind: "watcher_skipped_capacity", watcherId });
    return;
  }
  activeWatchers++;
  const startedAt = Date.now();
  const runId = db.prepare(`INSERT INTO watcher_runs(watcher_id,started_at,status) VALUES (?,?,?)`)
    .run(watcherId, startedAt, "running").lastInsertRowid as number;
  bus.emit("watcher:run-started", { watcherId, runId });
  try {
    const cwd = targetCwd(w.scope, w.target_id);
    const prompt = `You are a watcher named "${w.name}" (scope=${w.scope}).
User instruction: ${w.prompt}
Context: ${JSON.stringify(ctx ?? {})}
Reply ONLY with JSON: {"status":"ok"|"alert","message":"<1 sentence>","recommendation":"<1 sentence or 'none'>"}`;
    const r = await runClaude({ prompt, cwd, bin: opts.bin, args: opts.args, timeoutMs: opts.timeoutMs ?? 600_000 });

    let parsed: any = {};
    try {
      const m = r.stdout.match(/\{[\s\S]*\}\s*$/);
      parsed = JSON.parse(m ? m[0] : r.stdout);
    } catch { parsed = { status: "error", message: "could not parse claude JSON" }; }
    if (r.timedOut) parsed = { status: "error", message: "timeout" };
    if (r.exitCode !== 0 && !r.timedOut && !parsed.status) parsed = { status: "error", message: r.stderr.slice(-200) || "non-zero exit" };
    const status: "ok" | "alert" | "error" =
      parsed.status === "ok" || parsed.status === "alert" || parsed.status === "error" ? parsed.status : "error";

    db.prepare(`UPDATE watcher_runs SET ended_at=?, status=?, output=?, alert_msg=? WHERE id=?`)
      .run(Date.now(), status, r.stdout.slice(-4000), parsed.message ?? null, runId);

    const feedKind = status === "ok" ? "watcher_done" : status === "alert" ? "watcher_alert" : "watcher_error";
    const feedPayload = JSON.stringify({ watcherId, name: w.name, status, message: parsed.message, recommendation: parsed.recommendation });
    db.prepare(`INSERT INTO feed(ts,kind,project_id,session_id,payload) VALUES(?,?,?,?,?)`)
      .run(Date.now(), feedKind,
           w.scope === "project" ? w.target_id : null,
           w.scope === "session" ? w.target_id : null,
           feedPayload);

    bus.emit(status !== "ok" ? "watcher:alert" : "watcher:done", { watcherId, runId, status });
    bus.emit("feed:new", { kind: feedKind, watcherId, name: w.name, status, message: parsed.message });

    if (status === "alert" || status === "error") {
      const url = w.notify_webhook ?? (db.prepare("SELECT value FROM settings WHERE key='notify_webhook'").get() as any)?.value;
      if (url) await postWebhook(url, { watcher: w.name, scope: w.scope, target_id: w.target_id, message: parsed.message, recommendation: parsed.recommendation, ts: Date.now() }).catch(() => {});
    }

    const vault = (db.prepare("SELECT value FROM settings WHERE key='obsidian_vault_path'").get() as any)?.value;
    if (vault) {
      const { appendDailyNote } = await import("@/lib/obsidian/writer");
      await appendDailyNote(vault, {
        project: w.scope === "project" ? (db.prepare("SELECT name FROM projects WHERE id=?").get(w.target_id) as any)?.name ?? "?" : "global",
        sessionShort: w.scope === "session" ? String(w.target_id).slice(0, 8) : "—",
        time: new Date().toLocaleTimeString(),
        title: `watcher ${w.name}`,
        summary: parsed.message ?? null,
        recommendation: parsed.recommendation ?? null,
        watcherAlert: status === "alert" ? parsed.message : undefined
      }).catch(() => {});
    }
  } finally {
    activeWatchers--;
  }
}
