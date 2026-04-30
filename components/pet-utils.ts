import type { Pet } from "./PetCard";

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
