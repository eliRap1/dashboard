import fs from "node:fs/promises";
import { getDb } from "@/lib/db";
import { runClaude } from "@/lib/ai/runClaude";
import { bus } from "@/lib/bus";

export type SummarizeOpts = { bin?: string; args?: string[]; timeoutMs?: number };

const PROMPT_HEADER = `You are summarizing a Claude Code session for a dashboard.`;
const PROMPT_FOOTER = `Reply ONLY with JSON: {"title":"<8 words max>","summary":"<2-3 sentences>","recommendation":"<1 sentence or 'none'>","why_low_hp":null,"advice":null}`;
const MAX_TAIL_BYTES = 40_000;

export async function summarizeSession(sessionId: string, opts: SummarizeOpts = {}) {
  const db = getDb();
  const s = db.prepare(`SELECT s.*, p.cwd AS pcwd, p.name AS pname
                        FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?`).get(sessionId) as any;
  if (!s) throw new Error(`session ${sessionId} not found`);
  let tail = "";
  try {
    const buf = await fs.readFile(s.jsonl_path, "utf8");
    tail = buf.length > MAX_TAIL_BYTES ? buf.slice(-MAX_TAIL_BYTES) : buf;
  } catch { tail = "(could not read jsonl)"; }

  const prompt = `${PROMPT_HEADER}
Project: ${s.pname} (${s.pcwd})
Session: ${s.id} (${s.msg_count} turns, started ${new Date(s.started_at).toISOString()})

Recent jsonl excerpt:
${tail}

${PROMPT_FOOTER}`;

  const r = await runClaude({ prompt, cwd: s.pcwd, bin: opts.bin, args: opts.args, timeoutMs: opts.timeoutMs ?? 120_000 });
  let parsed: any = {};
  try {
    const m = r.stdout.match(/\{[\s\S]*\}\s*$/);
    parsed = JSON.parse(m ? m[0] : r.stdout);
  } catch {
    parsed = { title: "(parse failed)", summary: r.stdout.slice(0, 400), recommendation: "none" };
  }

  db.prepare(`INSERT INTO summaries(session_id,title,summary,recommendation,generated_at,generator)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(session_id) DO UPDATE SET title=excluded.title,summary=excluded.summary,
                recommendation=excluded.recommendation,generated_at=excluded.generated_at,generator=excluded.generator`)
    .run(sessionId, parsed.title ?? null, parsed.summary ?? null, parsed.recommendation ?? null, Date.now(), "claude -p");

  db.prepare("DELETE FROM summaries_fts WHERE session_id=?").run(sessionId);
  db.prepare("INSERT INTO summaries_fts(session_id,title,summary,recommendation) VALUES (?,?,?,?)")
    .run(sessionId, parsed.title ?? "", parsed.summary ?? "", parsed.recommendation ?? "");

  if (parsed.advice) {
    db.prepare("UPDATE pet_health SET ai_advice=? WHERE scope='session' AND target_id=?").run(parsed.advice, sessionId);
  }

  db.prepare(`INSERT INTO feed(ts,kind,project_id,session_id,payload) VALUES(?,?,?,?,?)`)
    .run(Date.now(), "summary_ready", s.project_id, sessionId,
         JSON.stringify({ title: parsed.title, summary: parsed.summary, recommendation: parsed.recommendation }));

  const vault = (db.prepare("SELECT value FROM settings WHERE key='obsidian_vault_path'").get() as any)?.value;
  if (vault) {
    const { appendDailyNote } = await import("@/lib/obsidian/writer");
    await appendDailyNote(vault, {
      project: s.pname,
      sessionShort: sessionId.slice(0, 8),
      time: new Date().toLocaleTimeString(),
      title: parsed.title,
      summary: parsed.summary,
      recommendation: parsed.recommendation
    }).catch(() => {});
  }

  bus.emit("feed:new", { kind: "summary_ready", sessionId, projectId: s.project_id });
}
