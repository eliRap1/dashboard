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
  if (role)      { conds.push("role = ?");  args.push(role); }
  if (since)     { conds.push("ts >= ?");   args.push(parseInt(since, 10)); }
  // Push project filter into SQL so the LIMIT 200 is applied after scoping,
  // not before (post-JS filtering was silently truncating project results).
  if (projectId) {
    conds.push("session_id IN (SELECT id FROM sessions WHERE project_id=?)");
    args.push(projectId);
  }
  const sql = `SELECT session_id, role, snippet(messages_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet, ts
               FROM messages_fts WHERE ${conds.join(" AND ")} ORDER BY ts DESC LIMIT 200`;
  const rows = getDb().prepare(sql).all(...args).map((r: any) => ({ ...r }));
  return NextResponse.json(rows);
}
