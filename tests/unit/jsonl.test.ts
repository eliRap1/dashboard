import { describe, expect, it } from "vitest";
import path from "node:path";
import { parseJsonlFile } from "@/lib/indexer/jsonl";

const fix = (n: string) => path.resolve(process.cwd(), "tests/fixtures", n);

describe("parseJsonlFile", () => {
  it("counts messages, tokens, errors on simple session", async () => {
    const r = await parseJsonlFile(fix("session-simple.jsonl"));
    expect(r.msgCount).toBe(3);
    expect(r.tokensIn).toBe(12);
    expect(r.tokensOut).toBe(3);
    expect(r.errorCount).toBe(0);
    expect(r.model).toBe("claude-opus-4-7");
  });
  it("detects is_error=true tool results", async () => {
    const r = await parseJsonlFile(fix("session-with-error.jsonl"));
    expect(r.errorCount).toBe(1);
  });
  it("yields message rows with role+content", async () => {
    const r = await parseJsonlFile(fix("session-simple.jsonl"));
    expect(r.messages.length).toBe(3);
    expect(r.messages[0].role).toBe("user");
    expect(r.messages[0].content).toContain("hi");
  });
});
