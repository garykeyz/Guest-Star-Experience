"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dices, Music2, Shuffle, Sparkles, X } from "lucide-react";
import { GUEST_LANGUAGES, FUNNY_MESSAGES, PLAN_B_COPY } from "@/guest-star-bridge/public/shared/guest-locales.js";
import { rememberSuggested, selectPlanBSongs } from "@/guest-star-bridge/public/shared/plan-b.js";

export type GuestLanguage = "es" | "en" | "fr" | "it" | "de" | "ru" | "pt" | "hi";
const randomChooseLabel: Record<GuestLanguage, string> = {
  en: "RANDOM CHOOSE",
  es: "ELEGIR AL AZAR",
  fr: "CHOIX ALÉATOIRE",
  hi: "रैंडम चुनें",
  it: "SCELTA CASUALE",
  de: "ZUFÄLLIGE AUSWAHL",
  ru: "СЛУЧАЙНЫЙ ВЫБОР",
  pt: "ESCOLHER AO ACASO"
};
export type PlanBSong = {
  id:string; title:string; artist:string; language:GuestLanguage;
  genres:readonly string[]; era:string; energy:string; difficulty:string; aliases:readonly string[];
};

const LANGUAGE_KEY = "guest-star-plan-b-language-v1";
const RECENT_KEY = "guest-star-plan-b-recent-v1";

function storedLanguage(fallback:GuestLanguage, allowed:readonly GuestLanguage[]) {
  try {
    const saved=window.localStorage.getItem(LANGUAGE_KEY) as GuestLanguage|null;
    return saved&&allowed.includes(saved)?saved:fallback;
  } catch { return fallback; }
}

function storedRecent() {
  try {
    const parsed=JSON.parse(window.localStorage.getItem(RECENT_KEY)||"[]");
    return Array.isArray(parsed)?parsed.filter(value=>typeof value==="string").slice(-24):[];
  } catch { return []; }
}

export default function PlanBSuggestions({
  uiLanguage,
  songLanguage,
  allowedLanguages,
  onChoose
}: {
  uiLanguage:GuestLanguage;
  songLanguage:GuestLanguage;
  allowedLanguages:readonly GuestLanguage[];
  onChoose:(song:PlanBSong)=>void;
}) {
  const allowedKey=allowedLanguages.join(",");
  const allowed=useMemo(()=>GUEST_LANGUAGES.filter(language=>allowedLanguages.includes(language.code as GuestLanguage)),[allowedKey]);
  const fallback=(allowedLanguages.includes(songLanguage)?songLanguage:allowedLanguages.includes(uiLanguage)?uiLanguage:allowedLanguages[0]||"en") as GuestLanguage;
  const [open,setOpen]=useState(false);
  const [suggestionLanguage,setSuggestionLanguage]=useState<GuestLanguage>(fallback);
  const [recent,setRecent]=useState<string[]>([]);
  const [suggestions,setSuggestions]=useState<PlanBSong[]>([]);
  const [surprise,setSurprise]=useState<PlanBSong|null>(null);
  const copy=PLAN_B_COPY[uiLanguage]||PLAN_B_COPY.en;
  const funny=(FUNNY_MESSAGES[uiLanguage]||FUNNY_MESSAGES.en).planB[0];

  const persistRecent=useCallback((selected:PlanBSong[])=>{
    const next=rememberSuggested(recent,selected,24) as string[];
    setRecent(next);
    try{window.localStorage.setItem(RECENT_KEY,JSON.stringify(next));}catch{/* optional preference */}
  },[recent]);

  const draw=useCallback((count=5)=>{
    const next=selectPlanBSongs({language:suggestionLanguage,recentIds:recent,limit:count}) as PlanBSong[];
    persistRecent(next);
    return next;
  },[persistRecent,recent,suggestionLanguage]);

  useEffect(()=>{
    const next=storedLanguage(fallback,allowedLanguages);
    setSuggestionLanguage(next);
    setRecent(storedRecent());
  },[fallback,allowedKey]);

  useEffect(()=>{
    if(!open)return;
    const next=selectPlanBSongs({language:suggestionLanguage,recentIds:storedRecent(),limit:5}) as PlanBSong[];
    setSuggestions(next);setSurprise(null);
    const remembered=rememberSuggested(storedRecent(),next,24) as string[];
    setRecent(remembered);
    try{
      window.localStorage.setItem(LANGUAGE_KEY,suggestionLanguage);
      window.localStorage.setItem(RECENT_KEY,JSON.stringify(remembered));
    }catch{/* optional preferences */}
  },[open,suggestionLanguage]);

  const choose=(selected:PlanBSong)=>{onChoose(selected);setOpen(false);setSurprise(null);};
  const more=()=>{setSurprise(null);setSuggestions(draw(5));};
  const surpriseMe=()=>{const [selected]=draw(1);setSurprise(selected||null);};

  if(!open)return <button type="button" className="planBTrigger" onClick={()=>setOpen(true)}><Dices/><span className="planBTriggerCopy"><strong>{copy.open}</strong><small>{funny}</small></span><em>{randomChooseLabel[uiLanguage]||randomChooseLabel.en}</em></button>;

  return <section className="planBPanel" aria-label={copy.title}>
    <div className="planBHead"><div><small><Sparkles/> {randomChooseLabel[uiLanguage]||randomChooseLabel.en}</small><h3>{copy.title}</h3><p>{funny}</p></div><button type="button" className="planBClose" aria-label={copy.close} onClick={()=>setOpen(false)}><X/></button></div>
    <label className="planBLanguage">{copy.language}<select value={suggestionLanguage} onChange={event=>setSuggestionLanguage(event.target.value as GuestLanguage)}>{allowed.map(language=><option value={language.code} key={language.code}>{language.flag} {language.englishName}</option>)}</select></label>
    {surprise?<div className="planBSurprise"><small>{copy.yourSong}</small><Music2/><strong>{surprise.title}</strong><span>{surprise.artist}</span><button type="button" onClick={()=>choose(surprise)}>{copy.choose}</button><button type="button" className="planBSecondary" onClick={surpriseMe}><Dices/>{copy.tryAnother}</button></div>:<>
      <p className="planBPrompt">{copy.tryThese}</p><div className="planBSongs">{suggestions.map(item=><article key={item.id}><div><strong>{item.title}</strong><span>{item.artist}</span></div><button type="button" onClick={()=>choose(item)}>{copy.choose}</button></article>)}</div>
      <div className="planBActions"><button type="button" onClick={more}><Shuffle/>{copy.more}</button><button type="button" className="planBSurpriseButton" onClick={surpriseMe}><Dices/>{copy.surprise}</button></div>
    </>}
  </section>;
}
