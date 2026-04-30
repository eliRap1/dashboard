import { bus } from "@/lib/bus";
import { getDb } from "@/lib/db";
import { runWatcher } from "@/lib/scheduler/runner";

const EVENT_MAP: Record<string, string> = {
  "on:session_new":  "session:new",
  "on:session_msg":  "session:msg",
  "on:error":        "session:error",
  "on:plan_change":  "plan:change",
  "on:todo_change":  "todo:change"
};

export function startEventRouter() {
  const get = () => getDb().prepare(
    "SELECT id, target_id, scope, trigger_value FROM watchers WHERE trigger_kind='event' AND enabled=1"
  ).all() as any[];
  for (const evt of new Set(Object.values(EVENT_MAP))) {
    bus.on(evt, (ctx: any) => {
      for (const w of get()) {
        if (EVENT_MAP[w.trigger_value] !== evt) continue;
        if (w.scope === "session" && ctx?.sessionId && w.target_id !== ctx.sessionId) continue;
        if (w.scope === "project" && ctx?.projectId && w.target_id !== ctx.projectId) continue;
        runWatcher(w.id, {}, ctx).catch(() => {});
      }
    });
  }
}
