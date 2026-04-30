"use client";
import { useEffect, useState } from "react";
import { useEventStream } from "./useEventStream";

type Item = { id: number; ts: number; kind: string; project_id: string | null; session_id: string | null; payload: string };

export function FeedList() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { fetch("/api/feed").then(r => r.json()).then(setItems); }, []);
  useEventStream({ "feed:new": () => fetch("/api/feed").then(r => r.json()).then(setItems) });
  return (
    <ul className="space-y-2">
      {items.map(i => {
        let p: any = {}; try { p = JSON.parse(i.payload); } catch { /* ignore */ }
        return (
          <li key={i.id} className="border-2 border-stone-900 rounded-md p-3 bg-white">
            <div className="text-xs text-stone-500">{new Date(i.ts).toLocaleString()} · {i.kind}</div>
            <div className="font-bold">{p.name ?? p.title ?? i.kind}</div>
            {p.message        && <div className="text-sm">{p.message}</div>}
            {p.recommendation && <div className="text-sm text-stone-700">→ {p.recommendation}</div>}
          </li>
        );
      })}
    </ul>
  );
}
