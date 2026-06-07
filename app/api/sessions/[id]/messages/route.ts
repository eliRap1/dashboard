import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const url = new URL(req.url);
  const limitRaw  = parseInt(url.searchParams.get("limit")  ?? "100", 10);
  const offsetRaw = parseInt(url.searchParams.get("offset") ?? "0",   10);
  const limit  = Math.min(Number.isNaN(limitRaw)  ? 100 : limitRaw,  500);
  const offset = Math.max(Number.isNaN(offsetRaw) ? 0   : offsetRaw, 0);
  const rows = getDb().prepare(`
    SELECT role, content, ts FROM messages_fts WHERE session_id=? ORDER BY ts ASC LIMIT ? OFFSET ?
  `).all(params.id, limit, offset).map((r: any) => ({ ...r }));
  return NextResponse.json(rows);
}
