import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PAW · Persistent workspaces",
  description: "A calm place for your data, shaped by you.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
