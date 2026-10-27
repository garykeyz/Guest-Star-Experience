"use client";

import dynamic from "next/dynamic";
import type { ApiResponse, Lang } from "@/components/KaraokeExperience";

const KaraokeExperience = dynamic(
  () => import("@/components/KaraokeExperience"),
  {
    ssr: false,
    loading: () => <main className="page"><div className="brand notranslate" translate="no"><img className="gs-product-logo" src="/branding/brand-horizontal.png" width="300" height="100" alt="Guest Star Experience" /></div></main>
  }
);

export default function KaraokeExperienceClient(props: {
  hotelCode?: string;
  activitySessionToken?: string;
  initialState?: ApiResponse | null;
  onSessionInvalid?: (code: string) => void;
  onPublicUnavailable?: () => void;
  onStateChange?: (state: ApiResponse) => void;
  onRequestConfirmed?: () => void;
  uiLanguage?: Lang;
  onUiLanguageChange?: (language: Lang) => void;
}) {
  return <KaraokeExperience {...props} />;
}
