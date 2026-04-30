import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const bin = process.env.CLAUDE_BIN ?? "claude";
  try {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    return NextResponse.json({ claude_ok: r.status === 0, claude_version: (r.stdout || "").trim() || null });
  } catch {
    return NextResponse.json({ claude_ok: false, claude_version: null });
  }
}
