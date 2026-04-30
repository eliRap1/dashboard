import { headers } from "next/headers";
import Link from "next/link";
import { MessageList } from "@/components/MessageList";
import { LiveTailPanel } from "@/components/LiveTailPanel";
import { OpenInClaudeButton } from "@/components/OpenInClaudeButton";
import { RegenerateSummaryButton } from "@/components/RegenerateSummaryButton";

async function fetchSession(id: string) {
  const h = headers().get("host");
  const [meta, msgs] = await Promise.all([
    fetch(`http://${h}/api/sessions/${id}`,          { cache: "no-store" }).then(r => r.json()),
    fetch(`http://${h}/api/sessions/${id}/messages`, { cache: "no-store" }).then(r => r.json())
  ]);
  return { meta, msgs };
}

export default async function SessionPage({ params }: { params: { sessionId: string } }) {
  const { meta, msgs } = await fetchSession(params.sessionId);
  if (meta?.error) return <main className="p-6">not found</main>;
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <Link href={`/p/${meta.project_id}`} className="text-sm underline">← project</Link>
      <div className="flex items-center justify-between mt-2">
        <h1 className="text-2xl font-bold">{meta.title ?? params.sessionId}</h1>
        <OpenInClaudeButton kind="session" id={params.sessionId} label="Resume in Claude Code" />
      </div>
      <div className="text-sm text-stone-600 mb-4">{meta.project_name} · {meta.model ?? "?"} · HP {meta.hp ?? "—"} · {meta.face ?? ""}</div>

      {meta.summary && (
        <section className="bg-amber-100 border-2 border-stone-900 rounded-md p-3 mb-4">
          <div className="font-bold">Summary</div>
          <p>{meta.summary}</p>
          {meta.recommendation && <p className="mt-2"><strong>Recommendation:</strong> {meta.recommendation}</p>}
          {meta.ai_advice      && <p className="mt-2"><strong>Advice:</strong> {meta.ai_advice}</p>}
        </section>
      )}

      <div className="mb-4">
        <RegenerateSummaryButton sessionId={params.sessionId} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h2 className="font-bold mb-2">Messages</h2>
          <MessageList messages={msgs} />
        </div>
        <div>
          <h2 className="font-bold mb-2">Live tail</h2>
          <LiveTailPanel sessionId={params.sessionId} />
        </div>
      </div>
    </main>
  );
}
