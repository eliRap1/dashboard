import chokidar, { FSWatcher } from "chokidar";
import path from "node:path";
import crypto from "node:crypto";
import { plansDir, projectsDir, sessionsDir, todosDir, tasksDir } from "@/lib/paths";
import { bus } from "@/lib/bus";
import { debounce } from "@/lib/watcher/debounce";
import { parseJsonlFile } from "@/lib/indexer/jsonl";
import { isInternalSessionMessages } from "@/lib/indexer/scan";
import { getDb } from "@/lib/db";

let watcher: FSWatcher | null = null;

async function onJsonlChange(filePath: string) {
  const sessionId = path.basename(filePath, ".jsonl");
  const projectDirName = path.basename(path.dirname(filePath));
  const cwd = /^[A-Za-z]--/.test(projectDirName)
    ? projectDirName.replace(/^([A-Za-z])--/, "$1:\\").replace(/-/g, "\\")
    : "/" + projectDirName.replace(/^-/, "").replace(/-/g, "/");
  const projectId = crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 16);
  const db = getDb();
  const existed = db.prepare("SELECT id, tail_offset, is_internal FROM sessions WHERE id=?").get(sessionId) as any;
  const fromOffset = existed ? existed.tail_offset : 0;
  const r = await parseJsonlFile(filePath, fromOffset);
  if (r.msgCount === 0 && existed) return;

  // Compute is_internal: prior flag OR newly-detected from incoming messages
  const incomingInternal = isInternalSessionMessages(r.messages) ? 1 : 0;
  const internal = (existed?.is_internal ?? 0) || incomingInternal;

  db.prepare(`INSERT INTO projects(id,cwd,name,first_seen,last_seen) VALUES (?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen`)
    .run(projectId, cwd, path.basename(cwd), Date.now(), Date.now());

  db.prepare(`INSERT INTO sessions(id,project_id,jsonl_path,started_at,last_msg_at,msg_count,tokens_in,tokens_out,model,status,tail_offset,error_count,is_internal)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                last_msg_at=COALESCE(excluded.last_msg_at, sessions.last_msg_at),
                msg_count=sessions.msg_count + excluded.msg_count,
                tokens_in=sessions.tokens_in + excluded.tokens_in,
                tokens_out=sessions.tokens_out + excluded.tokens_out,
                model=COALESCE(excluded.model, sessions.model),
                tail_offset=excluded.tail_offset,
                error_count=sessions.error_count + excluded.error_count,
                is_internal=MAX(sessions.is_internal, excluded.is_internal)`)
    .run(sessionId, projectId, filePath, r.startedAt ?? Date.now(), r.lastMsgAt, r.msgCount, r.tokensIn, r.tokensOut, r.model, "active", r.endOffset, r.errorCount, internal);

  if (internal) return; // don't pollute fts or fire bus events for internal sessions

  const ins = db.prepare("INSERT INTO messages_fts(session_id,role,content,ts) VALUES (?,?,?,?)");
  for (const m of r.messages) ins.run(sessionId, m.role, m.content, m.ts);

  if (!existed) bus.emit("session:new", { sessionId, projectId });
  for (const m of r.messages) {
    bus.emit("session:msg", { sessionId, projectId, role: m.role, content: m.content, ts: m.ts });
    if (m.content.startsWith("[result:") && m.content.includes('"is_error":true')) bus.emit("session:error", { sessionId, projectId });
  }
}

const onJsonlDebounced = debounce((p: string) => { onJsonlChange(p).catch(() => {}); }, 250);

function classify(p: string) {
  if (p.endsWith(".jsonl")) onJsonlDebounced(p);
  else if (p.includes(`${path.sep}plans${path.sep}`)) bus.emit("plan:change", { path: p });
  else if (p.includes(`${path.sep}todos${path.sep}`)) bus.emit("todo:change", { path: p });
  else if (p.includes(`${path.sep}tasks${path.sep}`)) bus.emit("task:change", { path: p });
}

export async function startFsWatcher(): Promise<void> {
  if (watcher) return;
  watcher = chokidar.watch([projectsDir(), sessionsDir(), plansDir(), todosDir(), tasksDir()], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    depth: 4
  });
  watcher.on("add", classify);
  watcher.on("change", classify);
}

export async function stopFsWatcher(): Promise<void> {
  await watcher?.close(); watcher = null;
}
