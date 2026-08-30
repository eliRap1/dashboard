import { EventEmitter } from "node:events";

declare global {
  // eslint-disable-next-line no-var
  var __dashboardBus: EventEmitter | undefined;
}

function makeBus(): EventEmitter {
  const e = new EventEmitter();
  e.setMaxListeners(200);
  return e;
}

export const bus: EventEmitter = globalThis.__dashboardBus ?? (globalThis.__dashboardBus = makeBus());

export type BusEvents =
  | "session:new" | "session:msg" | "session:error"
  | "live:change" | "live:gone"
  | "watcher:run-started" | "watcher:done" | "watcher:alert"
  | "feed:new" | "health:change"
  | "plan:change" | "todo:change" | "task:change";
