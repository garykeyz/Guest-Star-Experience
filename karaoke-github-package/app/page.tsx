"use client";

import { useEffect, useState } from "react";
import KaraokeExperienceClient from "@/components/KaraokeExperienceClient";
import HostPanel from "@/components/HostPanel";
import { isHostPanelHostname } from "@/lib/guest-star/site-routing";

export default function Page() {
  const [surface, setSurface] = useState<"host" | "request" | null>(null);

  useEffect(() => {
    const hostname = window.location.hostname;
    setSurface(isHostPanelHostname(hostname) ? "host" : "request");
  }, []);

  if (surface === "host") return <HostPanel />;
  if (surface === "request") return <KaraokeExperienceClient hotelCode="default" />;
  return <main className="page"><div className="brand">✦ GUEST STAR EXPERIENCE</div></main>;
}
