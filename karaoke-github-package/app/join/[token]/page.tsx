"use client";

import { use, useEffect, useState } from "react";
import SessionRequestExperience from "@/components/SessionRequestExperience";
import { isKioskHostname } from "@/lib/guest-star/site-routing";

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [kioskMode, setKioskMode] = useState(false);
  useEffect(() => setKioskMode(isKioskHostname(window.location.hostname)), []);
  return <SessionRequestExperience joinToken={token} kioskMode={kioskMode} />;
}
