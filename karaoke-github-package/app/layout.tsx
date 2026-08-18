import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karaoke Night — Guest Star Experience",
  description: "Request your favorite song and shine on stage."
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
