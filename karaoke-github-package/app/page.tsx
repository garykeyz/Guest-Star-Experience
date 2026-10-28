"use client";

import { useEffect, useState } from "react";
import HostPanel from "@/components/HostPanel";
import SessionRequestExperience from "@/components/SessionRequestExperience";
import { isHostPanelHostname, isKioskHostname } from "@/lib/guest-star/site-routing";

export default function Page() {
  const [surface, setSurface] = useState<"host" | "request" | "kiosk" | null>(null);

  useEffect(() => {
    const hostname = window.location.hostname;
    setSurface(isHostPanelHostname(hostname) ? "host" : isKioskHostname(hostname) ? "kiosk" : "request");
  }, []);

  if (surface === "host") return <HostPanel />;
  if (surface === "kiosk") return <SessionRequestExperience kioskMode />;
  if (surface === "request") return <SessionRequestExperience />;
  return <main className="page"><div className="brand notranslate" translate="no"><img className="gs-product-logo" src="/branding/brand-horizontal.png" width="300" height="100" alt="Guest Star Experience" /></div></main>;
}
