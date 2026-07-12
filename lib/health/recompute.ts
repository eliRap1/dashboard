import { getDb } from "@/lib/db";
import { computeSessionHealth, type Weights } from "@/lib/health/compute";
import { faceForHp } from "@/lib/health/face";
import { bus } from "@/lib/bus";

function readSettings() {
  const db = getDb();
  const get = (k: string, fb: string) =>
    (db.prepare("SELECT value FROM settings WHERE key=?").get(k) as any)?.value ?? fb;
  let weights: Weights;
  try {
    weights = JSON.parse(get("health_weights", '{"activity":0.4,"errors":0.3,"watcher":0.2,"tokens":0.1}')) as Weights;
  } catch {
    weights = { activity: 0.4, errors: 0.3, watcher: 0.2, tokens: 0.1 } as Weights;
  }
  const quota = parseInt(get("quota_threshold", "5000000"), 10);
  const strategy = get("project_hp_strategy", "max") as "max" | "avg";
  return { weights, quota, strategy };
}

export function recomputeSessionHealth(sessionId: string) {
  const db = getDb();
  const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(sessionId) as any;
  if (!s) return;
  const last = db.prepare(`SELECT status FROM watcher_runs
    WHERE watcher_id IN (SELECT id FROM watchers WHERE scope='session' AND target_id=?)
    ORDER BY started_at DESC LIMIT 1`).get(sessionId) as any;
  const { weights, quota } = readSettings();
  const r = computeSessionHealth({
    lastMsgAt: s.last_msg_at, errorCount: s.error_count ?? 0, msgCount: s.msg_count ?? 1,
    latestWatcherStatus: (last?.status ?? "none") as any,
    tokens: (s.tokens_in ?? 0) + (s.tokens_out ?? 0),
    quotaThreshold: quota
  }, weights);
  db.prepare(`INSERT INTO pet_health(scope,target_id,hp,activity_pct,error_pct,watcher_pct,tokens_pct,face,ai_advice,computed_at)
              VALUES('session',?,?,?,?,?,?,?,(SELECT ai_advice FROM pet_health WHERE scope='session' AND target_id=?),?)
              ON CONFLICT(scope,target_id) DO UPDATE SET
                hp=excluded.hp, activity_pct=excluded.activity_pct, error_pct=excluded.error_pct,
                watcher_pct=excluded.watcher_pct, tokens_pct=excluded.tokens_pct, face=excluded.face,
                computed_at=excluded.computed_at`)
    .run(sessionId, r.hp, r.activityPct, r.errorPct, r.watcherPct, r.tokensPct, r.face, sessionId, Date.now());
  bus.emit("health:change", { scope: "session", targetId: sessionId, hp: r.hp });
}

export function recomputeProjectHealth(projectId: string) {
  const db = getDb();
  const { strategy } = readSettings();
  const rows = db.prepare(`SELECT ph.hp FROM pet_health ph JOIN sessions s ON s.id=ph.target_id
                           WHERE ph.scope='session' AND s.project_id=?`).all(projectId) as any[];
  if (rows.length === 0) return;
  const hp = strategy === "avg"
    ? Math.round(rows.reduce((a, r) => a + r.hp, 0) / rows.length)
    : Math.max(...rows.map(r => r.hp));
  db.prepare(`INSERT INTO pet_health(scope,target_id,hp,face,computed_at) VALUES('project',?,?,?,?)
              ON CONFLICT(scope,target_id) DO UPDATE SET hp=excluded.hp, face=excluded.face, computed_at=excluded.computed_at`)
    .run(projectId, hp, faceForHp(hp), Date.now());
  bus.emit("health:change", { scope: "project", targetId: projectId, hp });
}
