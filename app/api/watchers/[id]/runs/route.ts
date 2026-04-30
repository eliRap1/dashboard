import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  return NextResponse.json(
    getDb().prepare("SELECT * FROM watcher_runs WHERE watcher_id=? ORDER BY started_at DESC LIMIT 100").all(params.id).map((r: any) => ({ ...r }))
  );
}
