import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { getDb } from "@/lib/db";
import { ensureBoot } from "@/lib/singletons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function escWinArg(s: string): string { return `"${s.replace(/"/g, '""')}"`; }

export async function POST(_: Request, { params }: { params: { id: string } }) {
  await ensureBoot();
  const t = getDb().prepare(`
    SELECT t.*, p.cwd AS pcwd FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?
  `).get(params.id) as any;
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });

  let cfg: any = {};
  try { cfg = JSON.parse(t.config); } catch { /* leave empty */ }

  const cwd: string = path.normalize(t.pcwd);

  try {
    if (t.kind === "open_url") {
      if (!cfg.url) return NextResponse.json({ error: "config.url missing" }, { status: 400 });
      if (process.platform === "win32") {
        spawn("cmd.exe", ["/c", "start", "", cfg.url], { detached: true, stdio: "ignore" }).unref();
      } else if (process.platform === "darwin") {
        spawn("open", [cfg.url], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("xdg-open", [cfg.url], { detached: true, stdio: "ignore" }).unref();
      }
      return NextResponse.json({ ok: true, kind: t.kind, url: cfg.url });
    }

    if (t.kind === "run_command") {
      if (!cfg.command) return NextResponse.json({ error: "config.command missing" }, { status: 400 });
      const cmd: string = cfg.command;
      const persist: boolean = cfg.keep_open !== false; // default true
      if (process.platform === "win32") {
        const flag = persist ? "/k" : "/c";
        spawn("cmd.exe", ["/c", "start", "", "cmd.exe", flag, `cd /d ${escWinArg(cwd)} && ${cmd}`],
          { detached: true, stdio: "ignore" }).unref();
      } else if (process.platform === "darwin") {
        const script = `tell application "Terminal" to do script "cd ${cwd.replace(/"/g, '\\"')} && ${cmd}"`;
        spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("x-terminal-emulator", ["--working-directory", cwd, "-e", "sh", "-c", cmd],
          { detached: true, stdio: "ignore" }).unref();
      }
      return NextResponse.json({ ok: true, kind: t.kind, cwd, command: cmd });
    }

    if (t.kind === "tail_log") {
      // tail_log is a passive viewer; no spawn. Tail endpoint streams file via SSE.
      return NextResponse.json({ ok: true, kind: t.kind, message: "open the tail page from the UI" });
    }

    return NextResponse.json({ error: `unknown kind ${t.kind}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
