import "./globals.css";
export const metadata = { title: "Claude Session Dashboard" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="bg-amber-50 text-stone-900">{children}</body></html>;
}
