import { headers } from "next/headers";
import Link from "next/link";
import { PetCard, type Pet } from "@/components/PetCard";
import { OpenInClaudeButton } from "@/components/OpenInClaudeButton";

async function fetchSessions(id: string): Promise<any[]> {
  try {
    const h = headers();
    const res = await fetch(`http://${h.get("host")}/api/projects/${id}/sessions`, { cache: "no-store" });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export default async function ProjectPage({ params }: { params: { projectId: string } }) {
  const rows = await fetchSessions(params.projectId);
  const pets: Pet[] = rows.map((r: any) => ({
    scope: "session",
    id: r.id,
    name: r.title ?? r.id.slice(0, 8),
    hp: r.hp ?? null,
    face: r.face ?? "(?_?)",
    lastMsgAt: r.last_msg_at ?? null,
    active: r.status === "active",
    href: `/s/${r.id}`,
    subline: `${r.msg_count ?? 0} turns · ${r.model ?? "?"}`
  }));
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <Link href="/" className="text-sm underline">← back to zoo</Link>
      <div className="flex items-center justify-between mt-2 mb-4">
        <h1 className="text-2xl font-bold">Project: {params.projectId}</h1>
        <OpenInClaudeButton kind="project" id={params.projectId} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {pets.map(p => <PetCard key={p.id} pet={p} />)}
      </div>
    </main>
  );
}
