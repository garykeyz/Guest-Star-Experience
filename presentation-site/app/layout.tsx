import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://gstarxp.com"),
  title: "Guest Star Experience — Tu evento. Su momento.",
  description: "Convierte karaoke, pantallas, cámara y participación del público en una experiencia que nadie quiere perderse.",
  openGraph: {
    title: "Guest Star Experience — Tu evento. Su momento.",
    description: "El sistema que transforma una canción en un show.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Guest Star Experience" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Guest Star Experience",
    description: "Tu evento. Su momento. Una experiencia inolvidable.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}