"use client";
import { useEffect, useRef } from "react";
import { renderBrandLogos } from "@/guest-star-bridge/public/shared/branding-theme";
import { normalizeBrandImageUrl } from "@/lib/guest-star/media-url";
export default function BrandLogos({hotelLogo,teamLogo}:{hotelLogo?:unknown;teamLogo?:unknown}) {
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(root.current)renderBrandLogos(root.current,[String(hotelLogo||""),String(teamLogo||"")],normalizeBrandImageUrl);},[hotelLogo,teamLogo]);
  return <div className="brandLogos" ref={root} hidden/>;
}
