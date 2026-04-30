import { spawn } from "node:child_process";
import treeKill from "tree-kill";

export type RunOpts = {
  prompt: string;
  cwd: string;
  bin?: string;
  args?: string[];
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
};
export type RunResult = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean };

export function runClaude(o: RunOpts): Promise<RunResult> {
  return new Promise((resolve) => {
    const bin = o.bin ?? process.env.CLAUDE_BIN ?? "claude";
    const args = [...(o.args ?? []), "-p", o.prompt];
    const child = spawn(bin, args, { cwd: o.cwd, shell: false, env: process.env });
    let stdout = ""; let stderr = ""; let timedOut = false;
    child.stdout.on("data", b => { const s = b.toString("utf8"); stdout += s; o.onStdout?.(s); });
    child.stderr.on("data", b => { stderr += b.toString("utf8"); });
    const t = setTimeout(() => { timedOut = true; if (child.pid) treeKill(child.pid); }, o.timeoutMs ?? 600_000);
    child.on("close", code => { clearTimeout(t); resolve({ exitCode: code, stdout, stderr, timedOut }); });
    child.on("error", () => { clearTimeout(t); resolve({ exitCode: null, stdout, stderr, timedOut }); });
  });
}
