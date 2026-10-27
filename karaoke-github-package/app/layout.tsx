import type { Metadata } from "next";
import { headers } from "next/headers";
import { isHostPanelHostname, isKioskHostname } from "@/lib/guest-star/site-routing";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const hostname = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "";
  const surface = isHostPanelHostname(hostname) ? "Host" : isKioskHostname(hostname) ? "Kiosko" : "Request";
  return {
    title: `${surface} - Guest Star Experience`,
    description: "Request your favorite song and shine on stage."
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><meta name="google" content="notranslate" /></head>
      <body>{children}</body>
    </html>
  );
}
