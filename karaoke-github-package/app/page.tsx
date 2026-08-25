import { headers } from "next/headers";
import KaraokeExperienceClient from "@/components/KaraokeExperienceClient";
import HostPanel from "@/components/HostPanel";
import { isHostPanelHostname } from "@/lib/guest-star/site-routing";

export default async function Page() {
  const hostname = (await headers()).get("host");
  if (isHostPanelHostname(hostname)) return <HostPanel />;
  return <KaraokeExperienceClient hotelCode="default" />;
}
