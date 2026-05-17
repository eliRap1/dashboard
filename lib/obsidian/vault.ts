import fs from "node:fs/promises";
import path from "node:path";

export async function ensureVaultDirs(vault: string): Promise<void> {
  await fs.mkdir(path.join(vault, "Claude Sessions"), { recursive: true });
}
