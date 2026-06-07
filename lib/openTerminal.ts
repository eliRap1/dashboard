import { spawn } from "node:child_process";
import path from "node:path";

export type OpenOpts = {
  cwd: string;
  command?: string;            // command to run inside the new terminal; default = "claude"
  keepOpen?: boolean;          // Windows /k vs /c. default true
};

/**
 * Spawn a new visible terminal window at `cwd` and run `command` inside it.
 * Returns the platform tried, and any error message.
 *
 * On Windows: writes a tiny .bat to OS temp dir and `start`s it. Avoids the
 * quote-in-quote nightmare with `cmd.exe /c start "" cmd /k "..."` invocations.
 */
export function openTerminal(o: OpenOpts): { platform: string; ok: boolean; error?: string } {
  const cwd = path.normalize(o.cwd);
  const command = o.command ?? "claude";
  const keepOpen = o.keepOpen !== false;

  try {
    if (process.platform === "win32") {
      const fs = require("node:fs") as typeof import("node:fs");
      const os = require("node:os") as typeof import("node:os");
      const tmp = path.join(os.tmpdir(), `dashboard-launch-${Date.now()}-${Math.random().toString(36).slice(2,8)}.bat`);
      const bat = [
        "@echo off",
        `cd /d "${cwd}"`,
        command,
        keepOpen ? "cmd /k" : "exit"
      ].join("\r\n") + "\r\n";
      fs.writeFileSync(tmp, bat, { encoding: "utf8" });
      // `start` opens a new window and runs the .bat. Empty title arg required.
      const child = spawn("cmd.exe", ["/c", "start", "", "/D", cwd, "cmd.exe", "/k", tmp],
        { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
      return { platform: "win32", ok: true };
    }
    if (process.platform === "darwin") {
      const script = `tell application "Terminal" to do script "cd ${cwd.replace(/"/g, '\\"')} && ${command.replace(/"/g, '\\"')}"`;
      // Note: backslash-quoting is the extent of escaping available inside an AppleScript string literal.
      const child = spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" });
      child.unref();
      return { platform: "darwin", ok: true };
    }
    const child = spawn("x-terminal-emulator", ["--working-directory", cwd, "-e", "sh", "-c", command],
      { detached: true, stdio: "ignore" });
    child.unref();
    return { platform: "linux", ok: true };
  } catch (e: any) {
    return { platform: process.platform, ok: false, error: String(e) };
  }
}

export function openFolder(folder: string): { ok: boolean; error?: string } {
  const p = path.normalize(folder);
  try {
    if (process.platform === "win32") {
      spawn("explorer.exe", [p], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [p], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e) };
  }
}

export function openUrl(url: string): { ok: boolean; error?: string } {
  try {
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e) };
  }
}
