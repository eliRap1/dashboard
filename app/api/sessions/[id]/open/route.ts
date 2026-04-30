import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { openTerminal } from "@/lib/openTerminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const row = getDb().prepare(
    "SELECT p.cwd FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?"
  ).get(params.id) as any;
  if (!row?.cwd) return NextResponse.json({ error: "not found" }, { status: 404 });
  const claudeBin = process.env.CLAUDE_BIN ?? "claude";
  const r = openTerminal({ cwd: row.cwd, command: `${claudeBin} --resume ${params.id}`, keepOpen: true });
  if (!r.ok) return NextResponse.json({ error: r.error ?? "spawn failed" }, { status: 500 });
  return NextResponse.json({ ok: true, cwd: row.cwd, sessionId: params.id, platform: r.platform });
}
