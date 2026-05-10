import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  await ensureBoot();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const projectId = url.searchParams.get("project_id");
  const role      = url.searchParams.get("role");
  const since     = url.searchParams.get("since");
  if (!q) return NextResponse.json([]);
  const conds: string[] = []; const args: any[] = [];
  conds.push("messages_fts MATCH ?"); args.push(q);
  if (role)  { conds.push("role = ?");  args.push(role); }
  if (since) { conds.push("ts >= ?");   args.push(parseInt(since, 10)); }
  const sql = `SELECT session_id, role, snippet(messages_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet, ts
               FROM messages_fts WHERE ${conds.join(" AND ")} ORDER BY ts DESC LIMIT 200`;
  let rows: any[];
  try {
    rows = getDb().prepare(sql).all(...args).map((r: any) => ({ ...r }));
  } catch {
    // FTS5 MATCH syntax error (e.g. malformed query) — return empty results
    return NextResponse.json([]);
  }
  if (projectId) {
    const ids = new Set(
      (getDb().prepare("SELECT id FROM sessions WHERE project_id=?").all(projectId) as any[])
        .map((r: any) => r.id)
    );
    rows = rows.filter((r: any) => ids.has(r.session_id));
  }
  return NextResponse.json(rows);
}
