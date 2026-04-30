import { describe, expect, it } from "vitest";
import path from "node:path";
import { runClaude } from "@/lib/ai/runClaude";

const fake = path.resolve(process.cwd(), "scripts/fake-claude.cjs");

describe("runClaude", () => {
  it("captures stdout JSON from fake binary", async () => {
    const r = await runClaude({ prompt: "hello", cwd: process.cwd(), bin: process.execPath, args: [fake, "-p"], timeoutMs: 5000 });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout).status).toBe("ok");
  });
  it("returns timeout=true if process hangs", async () => {
    process.env.FAKE_CLAUDE_ENV = "timeout";
    const r = await runClaude({ prompt: "x", cwd: process.cwd(), bin: process.execPath, args: [fake, "-p"], timeoutMs: 500 });
    expect(r.timedOut).toBe(true);
    delete process.env.FAKE_CLAUDE_ENV;
  });
});
