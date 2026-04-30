import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";

const FRONT_MATTER = /^---\s*\n([\s\S]*?)\n---/;

function parseFront(md: string): Record<string, string> {
  const m = md.match(FRONT_MATTER);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: any[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith(".md")) yield p;
  }
}

export async function refreshVaultIndex(vault: string): Promise<number> {
  const db = getDb();
  const upsert = db.prepare(`INSERT INTO obsidian_notes(path,project_id,session_id,mtime,excerpt) VALUES (?,?,?,?,?)
                             ON CONFLICT(path) DO UPDATE SET project_id=excluded.project_id,
                               session_id=excluded.session_id, mtime=excluded.mtime, excerpt=excluded.excerpt`);
  let n = 0;
  for await (const file of walk(vault)) {
    try {
      const stat = await fs.stat(file);
      const txt  = await fs.readFile(file, "utf8");
      const fm   = parseFront(txt);
      const projRow = fm.project ? db.prepare("SELECT id FROM projects WHERE name=?").get(fm.project) as any : null;
      upsert.run(path.relative(vault, file), projRow?.id ?? null, fm.session ?? null, stat.mtimeMs, txt.slice(0, 400));
      n++;
    } catch { }
  }
  return n;
}
