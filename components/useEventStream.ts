"use client";
import { useEffect, useRef } from "react";

export function useEventStream(handlers: Record<string, (d: any) => void>, path = "/api/stream") {
  const ref = useRef(handlers);
  ref.current = handlers;
  // Stable sorted string so the effect re-runs when the caller adds or removes
  // event names (not just when handler function references change).
  const names = Object.keys(handlers).sort().join(",");
  useEffect(() => {
    const es = new EventSource(path);
    const subs = Object.keys(ref.current);
    const fns = subs.map(name => {
      const fn = (e: MessageEvent) => { try { ref.current[name]?.(JSON.parse(e.data)); } catch { /* ignore */ } };
      es.addEventListener(name, fn as any);
      return [name, fn] as const;
    });
    return () => { for (const [n, f] of fns) es.removeEventListener(n, f as any); es.close(); };
  }, [path, names]);
}
