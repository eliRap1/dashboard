import { faceForHp } from "@/lib/health/face";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type HealthInput = {
  lastMsgAt: number | null;
  errorCount: number;
  msgCount: number;
  latestWatcherStatus: "ok" | "alert" | "error" | "none";
  tokens: number;
  quotaThreshold: number;
};
export type Weights = { activity: number; errors: number; watcher: number; tokens: number };
export type HealthResult = {
  hp: number; activityPct: number; errorPct: number; watcherPct: number; tokensPct: number; face: string;
};

const clamp01  = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.round(Math.max(0, Math.min(100, n)));

export function computeSessionHealth(input: HealthInput, w: Weights): HealthResult {
  const now = Date.now();
  const sinceMs = input.lastMsgAt == null ? Infinity : now - input.lastMsgAt;
  const activity = clamp01(1 - sinceMs / WEEK_MS) * 100;
  const errorRatio = input.errorCount / Math.max(input.msgCount, 1);
  const errors = clamp01(1 - errorRatio) * 100;
  // "error" (watcher failed to run) must score lower than "alert" (watcher ran and flagged something).
  // Previous values had them inverted (error=50, alert=20).
  const watcher = input.latestWatcherStatus === "ok"    ? 100
                : input.latestWatcherStatus === "alert" ? 50
                : input.latestWatcherStatus === "error" ? 20
                :                                          70;
  const tokens = (1 - clamp01(input.tokens / Math.max(input.quotaThreshold, 1))) * 100;
  const hp = clamp100(w.activity * activity + w.errors * errors + w.watcher * watcher + w.tokens * tokens);
  return {
    hp,
    activityPct: clamp100(activity),
    errorPct:    clamp100(errors),
    watcherPct:  clamp100(watcher),
    tokensPct:   clamp100(tokens),
    face: faceForHp(hp)
  };
}
