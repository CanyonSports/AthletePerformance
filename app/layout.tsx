
import "./globals.css";
import { ReactNode } from "react";

export const metadata = { title: "Canyon Sports Performance", description: "Realtime Performance Dashboard" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en"><body>
      <header className="px-4 md:px-8 py-4 border-b border-white/10 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl" style={{ background: "#2F6F4F" }} />
        <h1 className="text-xl md:text-2xl font-semibold">Canyon Sports Performance</h1>
      </header>
      <main className="p-4 md:p-8">{children}</main>
    </body></html>
  );
}
