"use client";

import { useEffect, useState } from "react";
import SessionRequestExperience from "@/components/SessionRequestExperience";
import { isKioskHostname } from "@/lib/guest-star/site-routing";

export default function JoinByPinPage() {
  const [kioskMode, setKioskMode] = useState(false);
  useEffect(() => setKioskMode(isKioskHostname(window.location.hostname)), []);
  return <SessionRequestExperience kioskMode={kioskMode} />;
}
