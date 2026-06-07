import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { projectsDir } from "@/lib/paths";
import { parseJsonlFile } from "@/lib/indexer/jsonl";
import { bus } from "@/lib/bus";

function hashCwd(cwd: string): string {
  return crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 16);
}

function decodeProjectDir(name: string): string {
  if (/^[A-Za-z]--/.test(name)) {
    return name.replace(/^([A-Za-z])--/, "$1:\\").replace(/-/g, "\\");
  }
  return "/" + name.replace(/^-/, "").replace(/-/g, "/");
}

function projectName(cwd: string): string {
  return path.basename(cwd.replace(/[\/]+$/, "")) || cwd;
}

const INTERNAL_MARKERS = [
  "You are summarizing a Claude Code session for a dashboard.",
  "You are a watcher named ",
];

export function isInternalSessionMessages(messages: { role: string; content: string }[]): boolean {
  for (let i = 0; i < Math.min(messages.length, 8); i++) {
    const m = messages[i];
    if (!m) continue;
    for (const mark of INTERNAL_MARKERS) {
      if (m.content.includes(mark)) return true;
    }
  }
  return false;
}

export async function scanAll(): Promise<void> {
  const db = getDb();
  const root = projectsDir();
  let entries: string[] = [];
  try { entries = await fs.readdir(root); } catch { return; }
  const now = Date.now();

  const upsertProj = db.prepare(`
    INSERT INTO projects(id, cwd, name, first_seen, last_seen) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET cwd=excluded.cwd, name=excluded.name, last_seen=excluded.last_seen
  `);
  const upsertSession = db.prepare(`
    INSERT INTO sessions(id, project_id, jsonl_path, started_at, last_msg_at, msg_count, tokens_in, tokens_out, model, status, tail_offset, error_count, is_internal)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      last_msg_at=excluded.last_msg_at, msg_count=excluded.msg_count,
      tokens_in=excluded.tokens_in, tokens_out=excluded.tokens_out,
      model=COALESCE(excluded.model, sessions.model),
      tail_offset=excluded.tail_offset,
      error_count=excluded.error_count,
      is_internal=excluded.is_internal
  `);
  const deleteFts = db.prepare("DELETE FROM messages_fts WHERE session_id = ?");
  const insertFts = db.prepare("INSERT INTO messages_fts(session_id, role, content, ts) VALUES (?,?,?,?)");

  for (const dirName of entries) {
    const projDir = path.join(root, dirName);
    const stat = await fs.stat(projDir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const cwd = decodeProjectDir(dirName);
    const projId = hashCwd(cwd);
    upsertProj.run(projId, cwd, projectName(cwd), now, now);

    const files = (await fs.readdir(projDir)).filter(f => f.endsWith(".jsonl"));
    for (const f of files) {
      const sessionId = f.replace(/\.jsonl$/, "");
      const jsonlPath = path.join(projDir, f);
      const isNew = !db.prepare("SELECT 1 FROM sessions WHERE id=?").get(sessionId);
      const r = await parseJsonlFile(jsonlPath);
      const internal = isInternalSessionMessages(r.messages) ? 1 : 0;
      upsertSession.run(
        sessionId, projId, jsonlPath,
        r.startedAt ?? now, r.lastMsgAt, r.msgCount,
        r.tokensIn, r.tokensOut, r.model, "idle",
        r.endOffset, r.errorCount, internal
      );
      deleteFts.run(sessionId);
      if (!internal) {
        for (const m of r.messages) insertFts.run(sessionId, m.role, m.content, m.ts);
      }
      if (!internal && isNew) bus.emit("session:new", { sessionId, projectId: projId });
    }
  }
}
