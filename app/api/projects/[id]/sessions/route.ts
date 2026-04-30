import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const rows = getDb().prepare(`
    SELECT s.*, ph.hp, ph.face, sm.title, sm.summary
    FROM sessions s
    LEFT JOIN pet_health ph ON ph.scope='session' AND ph.target_id=s.id
    LEFT JOIN summaries sm  ON sm.session_id=s.id
    WHERE s.project_id=? ORDER BY s.last_msg_at DESC NULLS LAST
  `).all(params.id).map((r: any) => ({ ...r }));
  return NextResponse.json(rows);
}
