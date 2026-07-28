import type { Metadata } from "next";
import { Bungee, Caveat_Brush, Montserrat } from "next/font/google";
import "./globals.css";
import "./typography.css";

const bodyFont = Montserrat({
  variable: "--font-body",
  subsets: ["latin"],
});

const displayFont = Bungee({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const brushFont = Caveat_Brush({
  variable: "--font-brush",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Karaoke Night — Guest Star Experience",
  description:
    "Request your favorite karaoke song and get ready to shine on stage.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${bodyFont.variable} ${displayFont.variable} ${brushFont.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
