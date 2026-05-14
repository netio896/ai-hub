import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Omni-AI Hub",
  description: "Puter-powered UI with a Vercel API layer for Hermes/OpenClaw."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
