import { headers } from "next/headers";
import { PetGrid, rowToPet } from "@/components/PetGrid";

async function fetchProjects() {
  const h = headers();
  const host = h.get("host");
  const res = await fetch(`http://${host}/api/projects`, { cache: "no-store" });
  return res.json();
}

export default async function Home() {
  const rows = await fetchProjects();
  const pets = (rows as any[]).map(rowToPet);
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Pet Zoo</h1>
        <nav className="flex gap-3 text-sm">
          <a href="/watchers" className="underline">Watchers</a>
          <a href="/feed" className="underline">Feed</a>
          <a href="/search" className="underline">Search</a>
          <a href="/settings" className="underline">Settings</a>
        </nav>
      </header>
      <PetGrid initial={pets} />
    </main>
  );
}
