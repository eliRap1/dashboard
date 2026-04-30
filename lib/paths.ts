import os from "node:os";
import path from "node:path";

export function claudeHome(): string {
  const override = process.env.CLAUDE_HOME?.trim();
  return override && override.length > 0 ? override : path.join(os.homedir(), ".claude");
}
export function projectsDir(): string { return path.join(claudeHome(), "projects"); }
export function sessionsDir(): string { return path.join(claudeHome(), "sessions"); }
export function plansDir():    string { return path.join(claudeHome(), "plans"); }
export function todosDir():    string { return path.join(claudeHome(), "todos"); }
export function tasksDir():    string { return path.join(claudeHome(), "tasks"); }
export function agentsDir():   string { return path.join(claudeHome(), "agents"); }

export function encodeCwdToProjectsDir(cwd: string): string {
  return cwd
    .replace(/^([A-Za-z]):/, "$1-")
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, "-");
}

export function assertUnderClaudeHome(p: string): void {
  const root = claudeHome();
  const resolved = path.resolve(p);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error(`path is outside claude home`);
  }
}
