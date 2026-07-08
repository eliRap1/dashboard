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
  if (projectId) { conds.push("sessions.project_id = ?"); args.push(projectId); }
  const fromClause = projectId
    ? "messages_fts JOIN sessions ON sessions.id = messages_fts.session_id"
    : "messages_fts";
  const sql = `SELECT messages_fts.session_id, messages_fts.role, snippet(messages_fts, 2, '<mark>', '</mark>', '…', 12) AS snippet, messages_fts.ts
               FROM ${fromClause} WHERE ${conds.join(" AND ")} ORDER BY messages_fts.ts DESC LIMIT 200`;
  let rows: any[];
  try {
    rows = getDb().prepare(sql).all(...args).map((r: any) => ({ ...r }));
  } catch (e: any) {
    if (e?.name === "SqliteError") {
      return NextResponse.json({ error: "invalid query" }, { status: 400 });
    }
    throw e;
  }
  return NextResponse.json(rows);
}
