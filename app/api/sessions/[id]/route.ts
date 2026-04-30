import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const row = getDb().prepare(`
    SELECT s.*, p.cwd, p.name AS project_name, sm.title, sm.summary, sm.recommendation,
           ph.hp, ph.face, ph.ai_advice
    FROM sessions s JOIN projects p ON p.id=s.project_id
    LEFT JOIN summaries sm ON sm.session_id=s.id
    LEFT JOIN pet_health ph ON ph.scope='session' AND ph.target_id=s.id
    WHERE s.id=?
  `).get(params.id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...(row as any) });
}
