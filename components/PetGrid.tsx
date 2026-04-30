"use client";
import { PetCard, Pet } from "./PetCard";
import { rowToPet } from "./pet-utils";
import { useEventStream } from "./useEventStream";
import { useState } from "react";

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
