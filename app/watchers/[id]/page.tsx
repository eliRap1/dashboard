import { WatcherDetail } from "@/components/WatcherDetail";

export default function WatcherPage({ params }: { params: { id: string } }) {
  return <WatcherDetail watcherId={params.id} />;
}
