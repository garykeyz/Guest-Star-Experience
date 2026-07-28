import type { Metadata } from "next";
import { Bungee, Caveat_Brush, Montserrat } from "next/font/google";
import "./globals.css";
import "./typography.css";

const montserrat = Montserrat({
  variable: "--font-body",
  subsets: ["latin"],
});

const bungee = Bungee({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const caveatBrush = Caveat_Brush({
  variable: "--font-brush",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Karaoke Night — Guest Star Experience",
  description: "Request your favorite song and get ready to shine on stage.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${montserrat.variable} ${bungee.variable} ${caveatBrush.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
