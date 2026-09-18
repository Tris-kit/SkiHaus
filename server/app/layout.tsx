// Root layout for the Next-rendered pages only — the invite flow, the guest
// page, privacy and terms. The main app at `/` is the exported Expo web
// bundle in public/index.html and never passes through here.

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkiHaus",
  description: "Run a ski lease without the group text.",
};

export const viewport: Viewport = {
  themeColor: "#1D6FE0",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
