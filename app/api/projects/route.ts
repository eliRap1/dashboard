import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await ensureBoot();
  const rows = getDb().prepare(`
    SELECT p.*, ph.hp, ph.face,
           (SELECT MAX(last_msg_at) FROM sessions WHERE project_id=p.id) AS last_msg_at,
           (SELECT COUNT(*)         FROM sessions WHERE project_id=p.id) AS session_count
    FROM projects p LEFT JOIN pet_health ph ON ph.scope='project' AND ph.target_id=p.id
    ORDER BY last_msg_at DESC NULLS LAST
  `).all().map((r: any) => ({ ...r }));
  return NextResponse.json(rows);
}
