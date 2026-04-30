"use client";
import { PetCard, Pet } from "./PetCard";
import { useEventStream } from "./useEventStream";
import { useState } from "react";

export function rowToPet(r: any): Pet {
  return {
    scope: "project",
    id: r.id, name: r.name,
    hp: r.hp ?? null, face: r.face ?? "(?_?)",
    lastMsgAt: r.last_msg_at ?? null,
    active: false,
    href: `/p/${r.id}`,
    subline: `${r.session_count ?? 0} sessions`
  };
}

export function PetGrid({ initial }: { initial: Pet[] }) {
  const [pets, setPets] = useState<Pet[]>(initial);
  useEventStream({
    "health:change": (d: any) => setPets(p => p.map(x => x.id === d.targetId && x.scope === d.scope ? { ...x, hp: d.hp } : x)),
    "live:change":   () => { fetch("/api/projects").then(r => r.json()).then((rows: any[]) => setPets(rows.map(rowToPet))); }
  });
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {pets.map(p => <PetCard key={`${p.scope}:${p.id}`} pet={p} />)}
    </div>
  );
}
