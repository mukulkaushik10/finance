import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Control Room", template: "%s · Control Room" },
  description: "Test, gate, monitor and audit AI agents before they act on real money.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
