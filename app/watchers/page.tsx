"use client";
import { WatcherForm } from "@/components/WatcherForm";
import { WatcherList } from "@/components/WatcherList";
import { useState } from "react";

export default function WatchersPage() {
  const [tick, setTick] = useState(0);
  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Watchers</h1>
      <WatcherForm onCreated={() => setTick(t => t + 1)} />
      <div className="my-6"><WatcherList key={tick} /></div>
    </main>
  );
}
