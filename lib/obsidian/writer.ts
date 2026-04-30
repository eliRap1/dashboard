import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { ensureVaultDirs } from "@/lib/obsidian/vault";

export type DailyEntry = {
  title?: string | null;
  summary?: string | null;
  recommendation?: string | null;
  project: string;
  sessionShort: string;
  time: string;
  watcherAlert?: string;
};

export async function appendDailyNote(vault: string, e: DailyEntry): Promise<void> {
  await ensureVaultDirs(vault);
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(vault, "Claude Sessions", `${date}.md`);
  try { await fs.access(file); } catch { await fs.writeFile(file, `# Claude Sessions ${date}\n\n`, "utf8"); }
  const release = await lockfile.lock(file, { retries: { retries: 5, minTimeout: 50 } });
  try {
    const block = [
      `## ${e.time} · ${e.project} · ${e.sessionShort}`,
      e.title          ? `**Title:** ${e.title}` : null,
      e.summary        ? `**Summary:** ${e.summary}` : null,
      e.recommendation ? `**Recommendation:** ${e.recommendation}` : null,
      e.watcherAlert   ? `\n> Watcher alert: ${e.watcherAlert}` : null,
      ""
    ].filter(Boolean).join("\n") + "\n";
    await fs.appendFile(file, block, "utf8");
  } finally { await release(); }
}
