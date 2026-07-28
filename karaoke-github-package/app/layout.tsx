import type { Metadata } from "next";
import { Bungee, Caveat_Brush, Montserrat } from "next/font/google";
import "./globals.css";

const body = Montserrat({ variable: "--font-body", subsets: ["latin"] });
const display = Bungee({ variable: "--font-display", weight: "400", subsets: ["latin"] });
const brush = Caveat_Brush({ variable: "--font-brush", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Karaoke Night — Guest Star Experience",
  description: "Request your favorite song and shine on stage."
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${body.variable} ${display.variable} ${brush.variable}`}>{children}</body>
    </html>
  );
}
