import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";
import { openTerminal } from "@/lib/openTerminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Session IDs are hex strings from Claude's JSONL filenames; reject anything else
// to prevent shell injection when the ID is interpolated into the terminal command.
const SESSION_ID_RE = /^[a-f0-9-]{8,64}$/i;

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  if (!SESSION_ID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }
  const row = getDb().prepare(
    "SELECT p.cwd FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?"
  ).get(params.id) as any;
  if (!row?.cwd) return NextResponse.json({ error: "not found" }, { status: 404 });
  const claudeBin = process.env.CLAUDE_BIN ?? "claude";
  const r = openTerminal({ cwd: row.cwd, command: `${claudeBin} --resume ${params.id}`, keepOpen: true });
  if (!r.ok) return NextResponse.json({ error: r.error ?? "spawn failed" }, { status: 500 });
  return NextResponse.json({ ok: true, cwd: row.cwd, sessionId: params.id, platform: r.platform });
}
