import { describe, expect, it } from "vitest";
import { computeSessionHealth } from "@/lib/health/compute";

const W = { activity: 0.4, errors: 0.3, watcher: 0.2, tokens: 0.1 };

describe("computeSessionHealth", () => {
  it("fresh activity, no errors, ok watcher, low tokens => high HP", () => {
    const r = computeSessionHealth({
      lastMsgAt: Date.now() - 60_000, errorCount: 0, msgCount: 10,
      latestWatcherStatus: "ok", tokens: 1000, quotaThreshold: 5_000_000
    }, W);
    expect(r.hp).toBeGreaterThanOrEqual(95);
  });
  it("week-old, many errors, alert watcher, near-quota => low HP", () => {
    const r = computeSessionHealth({
      lastMsgAt: Date.now() - 7 * 86400_000, errorCount: 5, msgCount: 5,
      latestWatcherStatus: "alert", tokens: 4_900_000, quotaThreshold: 5_000_000
    }, W);
    expect(r.hp).toBeLessThan(20);
  });
  it("clamps to 0..100", () => {
    const r = computeSessionHealth({
      lastMsgAt: Date.now() + 100_000_000, errorCount: 0, msgCount: 1,
      latestWatcherStatus: "none", tokens: 0, quotaThreshold: 1
    }, W);
    expect(r.hp).toBeLessThanOrEqual(100);
    expect(r.hp).toBeGreaterThanOrEqual(0);
  });
});
