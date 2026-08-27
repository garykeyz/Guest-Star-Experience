"use client";

import dynamic from "next/dynamic";

const KaraokeExperience = dynamic(
  () => import("@/components/KaraokeExperience"),
  {
    ssr: false,
    loading: () => <main className="page"><div className="brand notranslate" translate="no">✦ GUEST STAR EXPERIENCE</div></main>
  }
);

export default function KaraokeExperienceClient({ hotelCode = "" }: { hotelCode?: string }) {
  return <KaraokeExperience hotelCode={hotelCode} />;
}
