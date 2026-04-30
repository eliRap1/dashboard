import "./globals.css";
import { BootBanner } from "@/components/BootBanner";
export const metadata = { title: "Claude Session Dashboard" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="bg-amber-50 text-stone-900"><BootBanner />{children}</body></html>;
}
