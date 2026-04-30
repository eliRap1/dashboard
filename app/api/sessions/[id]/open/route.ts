import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function escWinArg(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const row = getDb().prepare(
    "SELECT p.cwd FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?"
  ).get(params.id) as any;
  if (!row?.cwd) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cwd: string = path.normalize(row.cwd);
  const claudeBin = process.env.CLAUDE_BIN ?? "claude";
  const cmd = `${claudeBin} --resume ${params.id}`;

  try {
    if (process.platform === "win32") {
      const child = spawn("cmd.exe",
        ["/c", "start", "", "cmd.exe", "/k", `cd /d ${escWinArg(cwd)} && ${cmd}`],
        { detached: true, stdio: "ignore" });
      child.unref();
    } else if (process.platform === "darwin") {
      const script = `tell application "Terminal" to do script "cd ${cwd.replace(/"/g, '\\"')} && ${cmd}"`;
      const child = spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" });
      child.unref();
    } else {
      const child = spawn("x-terminal-emulator",
        ["--working-directory", cwd, "-e", "sh", "-c", cmd],
        { detached: true, stdio: "ignore" });
      child.unref();
    }
    return NextResponse.json({ ok: true, cwd, sessionId: params.id });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
