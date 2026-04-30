import { FeedList } from "@/components/FeedList";
export default function FeedPage() {
  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Activity Feed</h1>
      <FeedList />
    </main>
  );
}
