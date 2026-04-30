"use client";
type Msg = { role: string; content: string; ts: number };
export function MessageList({ messages }: { messages: Msg[] }) {
  return (
    <div className="border-2 border-stone-900 rounded-md bg-white p-3 max-h-[60vh] overflow-y-auto font-mono text-xs space-y-2">
      {messages.map((m, i) => (
        <div key={i} className="border-b border-stone-200 pb-1">
          <span className="font-bold">{m.role}</span>
          <span className="text-stone-500" suppressHydrationWarning> · {new Date(m.ts).toLocaleString()}</span>
          <pre className="whitespace-pre-wrap mt-1">{m.content}</pre>
        </div>
      ))}
    </div>
  );
}
