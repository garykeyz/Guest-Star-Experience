"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, CalendarClock, ExternalLink, Hotel, KeyRound, Link2,
  LogOut, MapPin, Play, Plus, Radio, RefreshCw, ShieldCheck, Square,
  UserPlus, Users
} from "lucide-react";
import { canonicalHostPanelPath } from "@/lib/guest-star/site-routing";

type RecordValue = string | number | boolean | string[] | null | undefined;
type Entity = Record<string, RecordValue>;
type User = Entity & {
  userId: string;
  username: string;
  displayName: string;
  role: "superhost" | "host";
  mustChangePassword?: boolean;
};
type Selection = { hotels: Entity[]; venues: Entity[]; activities: Entity[] };
type HostResponse = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  error?: string;
  user?: User;
  selection?: Selection;
};
type GoogleFallbackAsset = {
  userId?: string; displayName?: string; email?: string;
  hotelId?: string; hotelName?: string; venueId?: string;
  activityId?: string; activityName?: string;
  sheetUrl?: string; formUrl?: string; formEditUrl?: string;
  lastResetAt?: string; updatedAt?: string;
};
type GoogleFallbackSnapshot = {
  snapshotId?: string; userId?: string; displayName?: string;
  hotelId?: string; activityId?: string; reason?: string;
  snapshotUrl?: string; createdAt?: string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options:{client_id:string;callback:(response:{credential?:string})=>void;auto_select?:boolean;cancel_on_tap_outside?:boolean}):void;
          renderButton(element:HTMLElement,options:Record<string,unknown>):void;
        };
      };
    };
  }
}

const EMPTY_SELECTION: Selection = { hotels: [], venues: [], activities: [] };
const GUEST_LANGUAGES = [
  ["es","Español"], ["en","English"], ["fr","Français"],
  ["it","Italiano"], ["de","Deutsch"], ["ru","Русский"], ["pt","Português"]
] as const;
const WEEKDAYS = [
  [0,"Sunday"], [1,"Monday"], [2,"Tuesday"], [3,"Wednesday"],
  [4,"Thursday"], [5,"Friday"], [6,"Saturday"]
] as const;
const BRANDING_MESSAGES = [
  ["welcomeMessage","Welcome message"],
  ["activityEndingMessage","Activity ending message"],
  ["upcomingActivityMessage","Upcoming activity message"],
  ["reviewInvitationMessage","Review invitation"],
  ["generalReviewMessage","General review message"],
  ["beforeStartClosedTitle","Before-start closed title"],
  ["beforeStartClosedMessage","Before-start closed message"],
  ["beforeStartOpenTitle","Before-start open title"],
  ["beforeStartOpenMessage","Before-start open message"],
  ["inProgressTitle","Live title"],
  ["inProgressMessage","Live message"],
  ["requestsClosedTitle","Requests-closed title"],
  ["requestsClosedMessage","Requests-closed message"],
  ["activityFinishedTitle","Finished activity title"],
  ["activityFinishedMessage","Finished message"],
  ["noActivityTitle","No-activity title"],
  ["noActivityMessage","No-activity message"]
] as const;

function friendlyHostError(value: unknown, code = "") {
  const message = String(value || "The action could not be completed.");
  if (code === "HOTEL_CREATION_IN_PROGRESS") {
    return "Another hotel is already being created. Wait a moment and refresh before trying again.";
  }
  if (code === "HOTEL_ALREADY_EXISTS") {
    return message;
  }
  if (code === "GOOGLE_AUTHORIZATION_REQUIRED") {
    return "Guest Star needs administrative attention. Contact your Superhost.";
  }
  if (code === "GOOGLE_SIGN_IN_NOT_CONFIGURED") {
    return "Google Sign-In has not been connected to Guest Star yet. Contact the Superhost.";
  }
  if (code === "GOOGLE_EMAIL_MISMATCH") {
    return "Use the same Google email saved in your Guest Star account.";
  }
  if (code === "GOOGLE_FALLBACK_NOT_READY") {
    return "The Google backup is not ready yet. Try again after the Superhost completes setup.";
  }
  return message;
}

async function hostApi(payload: Record<string, unknown>): Promise<HostResponse> {
  const response = await fetch("/api/host", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({})) as HostResponse;
  if (!response.ok || data.ok === false) {
    const error = new Error(friendlyHostError(data.error || data.code, String(data.code || "")));
    Object.assign(error, data);
    throw error;
  }
  return data;
}

function value(entity: Entity | undefined, field: string) {
  return String(entity?.[field] || "");
}

function activityLanguages(entity: Entity | undefined) {
  const direct = entity?.allowedLanguages;
  if (Array.isArray(direct) && direct.length) return direct;
  try {
    const parsed = JSON.parse(value(entity, "allowedLanguagesJson") || "[]");
    if (Array.isArray(parsed) && parsed.length) return parsed as string[];
  } catch {
    // Activities without a saved selection offer the complete language catalog.
  }
  return GUEST_LANGUAGES.map(([code])=>code);
}

function selectedLanguages(form:FormData){
  return GUEST_LANGUAGES.map(([code])=>form.get(`language_${code}`)==="on"?code:"").filter(Boolean);
}

function localizedMessages(entity:Entity){
  try{
    const parsed=JSON.parse(value(entity,"localizedMessagesJson")||"{}");
    return parsed&&typeof parsed==="object"?parsed as Record<string,Record<string,string>>:{};
  }catch{return {} as Record<string,Record<string,string>>;}
}

function hotelQrPngUrl(entity: Entity) {
  const fileId = value(entity, "qrFileId");
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  }
  const publicUrl = value(entity, "publicUrl");
  return publicUrl
    ? `https://quickchart.io/qr?size=900&margin=2&format=png&text=${encodeURIComponent(publicUrl)}`
    : "";
}

function DefaultPublicExperienceForm({
  hotels, venues, activities, current, busy, onSave
}: {
  hotels: Entity[];
  venues: Entity[];
  activities: Entity[];
  current: Entity;
  busy: boolean;
  onSave: (selection: { enabled: boolean; hotelId?: string; venueId?: string; activityId?: string }) => Promise<void>;
}) {
  const activeHotels=hotels.filter(item=>value(item,"status")==="active");
  const activeVenues=venues.filter(item=>value(item,"status")==="active");
  const activeActivities=activities.filter(item=>value(item,"status")!=="inactive");
  const configured=current.configured===true||String(current.configured)==="true";
  const available=current.available===true||String(current.available)==="true";
  const currentKey=`${value(current,"hotelId")}:${value(current,"venueId")}:${value(current,"activityId")}:${value(current,"updatedAt")}`;
  const [defaultHotelId,setDefaultHotelId]=useState("");
  const [defaultVenueId,setDefaultVenueId]=useState("");
  const [defaultActivityId,setDefaultActivityId]=useState("");

  useEffect(()=>{
    const requested=value(current,"hotelId");
    setDefaultHotelId(activeHotels.some(item=>value(item,"hotelId")===requested)
      ?requested:value(activeHotels[0],"hotelId"));
    setDefaultVenueId(value(current,"venueId"));
    setDefaultActivityId(value(current,"activityId"));
  },[currentKey,hotels]);

  useEffect(()=>{
    const options=activeVenues.filter(item=>value(item,"hotelId")===defaultHotelId);
    if(!options.some(item=>value(item,"venueId")===defaultVenueId)){
      setDefaultVenueId(value(options[0],"venueId"));
    }
  },[defaultHotelId,defaultVenueId,venues]);

  useEffect(()=>{
    const options=activeActivities.filter(item=>
      value(item,"hotelId")===defaultHotelId&&value(item,"venueId")===defaultVenueId
    );
    if(!options.some(item=>value(item,"activityId")===defaultActivityId)){
      setDefaultActivityId(value(options[0],"activityId"));
    }
  },[activities,defaultActivityId,defaultHotelId,defaultVenueId]);

  const venueOptions=activeVenues.filter(item=>value(item,"hotelId")===defaultHotelId);
  const activityOptions=activeActivities.filter(item=>
    value(item,"hotelId")===defaultHotelId&&value(item,"venueId")===defaultVenueId
  );
  const currentHotel=hotels.find(item=>value(item,"hotelId")===value(current,"hotelId"));
  const currentVenue=venues.find(item=>value(item,"venueId")===value(current,"venueId"));
  const currentActivity=activities.find(item=>value(item,"activityId")===value(current,"activityId"));

  return <details><summary>Default experience for request.gstarxp.com</summary>
    <p>{configured
      ?`${value(currentHotel,"name")||"Hotel"} · ${value(currentVenue,"name")||"Venue"} · ${value(currentActivity,"name")||"Activity"}`
      :"Automatic mode: the service uses the hotel’s current public activity."}</p>
    {configured&&!available&&<p className="hostError">This saved selection is unavailable. Choose an active hotel, venue and activity again.</p>}
    <div className="hostGrid three">
      <label>Hotel<select value={defaultHotelId} onChange={event=>setDefaultHotelId(event.target.value)}>{activeHotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label>
      <label>Event venue<select value={defaultVenueId} onChange={event=>setDefaultVenueId(event.target.value)} disabled={!venueOptions.length}>{venueOptions.map(item=><option key={value(item,"venueId")} value={value(item,"venueId")}>{value(item,"name")}</option>)}</select></label>
      <label>Activity<select value={defaultActivityId} onChange={event=>setDefaultActivityId(event.target.value)} disabled={!activityOptions.length}>{activityOptions.map(item=><option key={value(item,"activityId")} value={value(item,"activityId")}>{value(item,"name")}</option>)}</select></label>
    </div>
    <div className="entityLinks"><button type="button" disabled={busy||!defaultHotelId||!defaultVenueId||!defaultActivityId} onClick={()=>void onSave({enabled:true,hotelId:defaultHotelId,venueId:defaultVenueId,activityId:defaultActivityId})}>Save Default</button>{configured&&<button type="button" disabled={busy} onClick={()=>void onSave({enabled:false})}>Use Automatic Mode</button>}<a href="https://request.gstarxp.com" target="_blank" rel="noreferrer"><ExternalLink/>Open Root Page</a></div>
  </details>;
}

export default function HostPanel({ oneTimeCode = "" }: { oneTimeCode?: string }) {
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [user,setUser]=useState<User|null>(null);
  const [selection,setSelection]=useState<Selection>(EMPTY_SELECTION);
  const [selected,setSelected]=useState<HostResponse|null>(null);
  const [admin,setAdmin]=useState<HostResponse|null>(null);
  const [hotelId,setHotelId]=useState("");
  const [venueId,setVenueId]=useState("");
  const [activityId,setActivityId]=useState("");
  const [newActivityHotelId,setNewActivityHotelId]=useState("");
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const [showOwnPasswordForm,setShowOwnPasswordForm]=useState(false);
  const [reviews,setReviews]=useState<Entity[]>([]);
  const [codeVersion,setCodeVersion]=useState("");
  const [googleFallback,setGoogleFallback]=useState<HostResponse|null>(null);
  const googleButtonRef=useRef<HTMLDivElement|null>(null);

  const refreshAdmin=useCallback(async(currentUser:User|null=user)=>{
    if(currentUser?.role!=="superhost")return;
    setAdmin(await hostApi({action:"adminState"}));
  },[user]);

  const refreshGoogleFallback=useCallback(async()=>{
    const state=await hostApi({action:"googleFallbackState"});
    setGoogleFallback(state);
    return state;
  },[]);

  const acceptIdentity=useCallback(async(data:HostResponse)=>{
    const nextUser=data.user||null;
    setCodeVersion(String(data.codeBuild||data.codeVersion||""));
    setUser(nextUser);
    setSelection(data.selection||EMPTY_SELECTION);
    if(nextUser?.role==="superhost")setAdmin(await hostApi({action:"adminState"}));
  },[]);

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const data=oneTimeCode
          ? await hostApi({action:"consumeOneTimeLoginCode",code:oneTimeCode})
          : await hostApi({action:"me"});
        if(!active)return;
        await acceptIdentity(data);
        if(oneTimeCode)window.history.replaceState({},"",canonicalHostPanelPath(window.location.hostname));
      }catch{
        if(active)setUser(null);
      }finally{
        if(active)setLoading(false);
      }
    })();
    return()=>{active=false;};
  },[acceptIdentity,oneTimeCode]);

  useEffect(()=>{
    const nextHotel=hotelId||value(selection.hotels[0],"hotelId");
    if(nextHotel!==hotelId)setHotelId(nextHotel);
    const availableVenues=selection.venues.filter(item=>value(item,"hotelId")===nextHotel);
    if(!availableVenues.some(item=>value(item,"venueId")===venueId))setVenueId(value(availableVenues[0],"venueId"));
  },[hotelId,venueId,selection]);

  useEffect(()=>{
    const available=selection.activities.filter(item=>
      value(item,"hotelId")===hotelId&&value(item,"venueId")===venueId
    );
    if(!available.some(item=>value(item,"activityId")===activityId))setActivityId(value(available[0],"activityId"));
  },[activityId,hotelId,venueId,selection]);

  useEffect(()=>{
    if(!user){setGoogleFallback(null);return;}
    let active=true;
    void refreshGoogleFallback()
      .catch(loadError=>{
        if(active)setGoogleFallback({
          ok:false,
          code:String((loadError as HostResponse)?.code||"GOOGLE_FALLBACK_UNAVAILABLE"),
          error:loadError instanceof Error?loadError.message:"Google backup unavailable."
        });
      });
    return()=>{active=false;};
  },[refreshGoogleFallback,user]);

  const venues=useMemo(()=>selection.venues.filter(item=>value(item,"hotelId")===hotelId),[selection,hotelId]);
  const activities=useMemo(()=>selection.activities.filter(item=>value(item,"hotelId")===hotelId&&value(item,"venueId")===venueId),[selection,hotelId,venueId]);
  const context={hotelId,venueId,activityId,source:"web"};
  const googleClientId=String(googleFallback?.googleClientId||"");

  useEffect(()=>{
    const target=googleButtonRef.current;
    if(!user||!googleClientId||!target||!hotelId||!venueId||!activityId)return;
    let cancelled=false;
    const initialize=()=>{
      if(cancelled||!window.google||!googleButtonRef.current)return;
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id:googleClientId,
        auto_select:false,
        cancel_on_tap_outside:true,
        callback:response=>{
          if(!response.credential)return;
          setBusy(true);setError("");setNotice("");
          void hostApi({action:"linkGoogleFallback",credential:response.credential,hotelId,venueId,activityId})
            .then(async()=>{await refreshGoogleFallback();setNotice("Google backup connected. The same Form and Sheet will be reused for this Host.");})
            .catch(connectError=>setError(connectError instanceof Error?connectError.message:"Google backup could not be connected."))
            .finally(()=>setBusy(false));
        }
      });
      window.google.accounts.id.renderButton(googleButtonRef.current,{
        type:"standard",theme:"filled_black",size:"large",shape:"pill",text:"continue_with",width:280
      });
    };
    if(window.google){initialize();return()=>{cancelled=true;};}
    let script=document.getElementById("guest-star-google-identity") as HTMLScriptElement|null;
    if(!script){
      script=document.createElement("script");
      script.id="guest-star-google-identity";
      script.src="https://accounts.google.com/gsi/client";
      script.async=true;
      script.defer=true;
      document.head.appendChild(script);
    }
    script.addEventListener("load",initialize,{once:true});
    return()=>{cancelled=true;script?.removeEventListener("load",initialize);};
  },[activityId,googleClientId,hotelId,refreshGoogleFallback,user,venueId]);

  async function run(label:string,operation:()=>Promise<HostResponse>){
    setBusy(true);setError("");setNotice("");
    try{
      const data=await operation();
      if(data.activity&&data.state)setSelected(data);
      setNotice(String(data.warning||label));
      return data;
    }
    catch(actionError){setError(actionError instanceof Error?actionError.message:"The action failed.");return null;}
    finally{setBusy(false);}
  }

  async function login(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    setBusy(true);setError("");
    try{
      const data=await hostApi({
        action:"login",username:form.get("username"),password:form.get("password"),rememberLogin:true
      });
      await acceptIdentity(data);
    }catch(loginError){setError(loginError instanceof Error?loginError.message:"Login failed.");}
    finally{setBusy(false);}
  }

  async function changePassword(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const next=String(form.get("newPassword")||"");
    if(next!==String(form.get("confirmPassword")||"")){setError("The new passwords do not match.");return;}
    const changed=await run("Password updated.",()=>hostApi({action:"changePassword",currentPassword:form.get("currentPassword"),newPassword:next}));
    if(!changed)return;
    await acceptIdentity(await hostApi({action:"me"}));
    setShowOwnPasswordForm(false);
  }

  async function chooseActivity(){
    if(!hotelId||!venueId||!activityId){setError("Select a hotel, venue and activity.");return;}
    await run("Activity selected.",()=>hostApi({action:"selectActivity",...context}));
  }

  async function activityAction(action:string,label:string,extra:Record<string,unknown>={}){
    if(!selected){setError("Select the activity first.");return;}
    await run(label,()=>hostApi({action,...context,...extra}));
  }

  async function scheduleActivity(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const local=String(form.get("scheduledStartAt")||"");
    const recurrenceType=String(form.get("recurrenceType")||"none");
    const recurrenceDays=WEEKDAYS.map(([day])=>form.get(`weekday_${day}`)==="on"?day:-1).filter(day=>day>=0);
    if(["weekly","biweekly"].includes(recurrenceType)&&!recurrenceDays.length){
      setError("Choose at least one day of the week for this recurrence.");return;
    }
    await run("Activity schedule saved.",()=>hostApi({
      action:"scheduleActivity",...context,scheduledLocal:local,
      durationSeconds:Number(form.get("durationMinutes"))*60,
      requestOpeningLeadSeconds:Number(form.get("openingLeadMinutes"))*60,
      autoOpenRequests:form.get("autoOpenRequests")==="on",
      autoStartActivity:form.get("autoStartActivity")==="on",
      showCountdown:form.get("showCountdown")==="on",
      recurrenceType,recurrenceInterval:recurrenceType==="biweekly"?2:1,recurrenceDays
    }));
    await refreshAdmin();
  }

  async function loadReviews(){
    const data=await run("Reviews refreshed.",()=>hostApi({action:"listReviews",...context}));
    if(data)setReviews((data.reviews as Entity[]|undefined)||[]);
  }

  async function reviewAction(reviewId:string,operation:"archive"|"delete"){
    if(operation==="delete"&&!window.confirm("Delete this review? This action is audited."))return;
    const data=await run(`Review ${operation}d.`,()=>hostApi({action:"updateReview",...context,reviewId,operation}));
    if(data)await loadReviews();
  }

  async function saveBranding(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const messageValues=Object.fromEntries(BRANDING_MESSAGES.map(([field])=>[
      field,String(form.get(field)||"").trim()
    ]));
    const manualLocalized=Object.fromEntries(GUEST_LANGUAGES.map(([code])=>[
      code,
      Object.fromEntries(BRANDING_MESSAGES.map(([field])=>[field,String(form.get(`manual_${code}_${field}`)||"").trim()]).filter(([,message])=>message))
    ]));
    const branding={
      teamDisplayName:form.get("teamDisplayName"),teamType:form.get("teamType"),tagline:form.get("tagline"),
      hotelLogoUrl:form.get("hotelLogoUrl"),teamLogoUrl:form.get("teamLogoUrl"),
      primaryColor:form.get("primaryColor"),secondaryColor:form.get("secondaryColor"),accentColor:form.get("accentColor"),
      ...messageValues,
      messageSourceLanguage:form.get("messageSourceLanguage"),translationMode:form.get("translationMode"),
      localizedMessagesJson:manualLocalized,
      externalReviewProvider:form.get("externalReviewProvider"),externalReviewUrl:form.get("externalReviewUrl"),
      showHotelName:form.get("showHotelName")==="on",showHotelLogo:form.get("showHotelLogo")==="on",
      showTeamIdentity:form.get("showTeamIdentity")==="on",
      showActivityDetails:form.get("showActivityDetails")==="on",showCountdown:form.get("showCountdown")==="on",
      showNextActivity:form.get("showNextActivity")==="on",showInternalRating:form.get("showInternalRating")==="on",
      showExternalReview:form.get("showExternalReview")==="on",showRemindMe:form.get("showRemindMe")==="on",
      showAddToCalendar:form.get("showAddToCalendar")==="on",offerFollowUp:form.get("offerFollowUp")==="on"
    };
    const data=await run("Hotel branding and guest experience updated.",()=>hostApi({action:"updateHotelBranding",hotelId,branding}));
    if(data)await refreshAdmin();
  }

  async function createHotel(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);
    const data=await run("Hotel created. Its permanent public link is ready.",()=>hostApi({action:"createHotel",name:form.get("name"),timezone:form.get("timezone")}));
    if(data){if(data.warning)setNotice(String(data.warning));formElement.reset();await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function saveDefaultPublicExperience(selection:{enabled:boolean;hotelId?:string;venueId?:string;activityId?:string}){
    const data=await run(selection.enabled?"Default public experience saved.":"Automatic public experience restored.",()=>hostApi({
      action:"setDefaultPublicExperience",...selection
    }));
    if(data)await refreshAdmin();
  }

  async function useGoogleFallbackAtRoot(asset:GoogleFallbackAsset){
    const data=await run("Google backup assigned to request.gstarxp.com.",()=>hostApi({
      action:"setDefaultGoogleFallback",enabled:true,
      formUrl:asset.formUrl,userId:asset.userId,hotelId:asset.hotelId,
      venueId:asset.venueId,activityId:asset.activityId
    }));
    if(data){await refreshGoogleFallback();await refreshAdmin();}
  }

  async function disableGoogleFallbackAtRoot(){
    const data=await run("Guest Star restored at request.gstarxp.com.",()=>hostApi({
      action:"setDefaultGoogleFallback",enabled:false
    }));
    if(data){await refreshGoogleFallback();await refreshAdmin();}
  }

  async function createVenue(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);
    const data=await run("Venue created.",()=>hostApi({action:"createVenue",hotelId:form.get("hotelId"),name:form.get("name")}));
    if(data){formElement.reset();await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function updateVenueRecord(event:FormEvent<HTMLFormElement>,venue:Entity){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const data=await run("Venue updated.",()=>hostApi({
      action:"updateVenue",venueId:value(venue,"venueId"),name:form.get("name")
    }));
    if(data){await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function setVenueStatus(venue:Entity,status:"inactive"|"active"){
    if(status==="inactive"&&!window.confirm(`Delete ${value(venue,"name")}? It can be restored later.`))return;
    const data=await run(status==="inactive"?"Venue deleted and recoverable.":"Venue restored.",()=>hostApi({
      action:"updateVenue",venueId:value(venue,"venueId"),status
    }));
    if(data){await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function createActivity(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);
    const allowedLanguages=selectedLanguages(form);
    if(!allowedLanguages.length){setError("Select at least one guest language.");return;}
    const data=await run("Activity created.",()=>hostApi({
      action:"createActivity",hotelId:form.get("hotelId"),venueId:form.get("venueId"),name:form.get("name"),
      defaultDurationSeconds:Number(form.get("durationMinutes"))*60,
      defaultTransitionSeconds:Number(form.get("transitionSeconds")),showCountdown:true,allowedLanguages
    }));
    if(data){formElement.reset();await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function updateActivityRecord(event:FormEvent<HTMLFormElement>,activity:Entity){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const data=await run("Activity updated.",()=>hostApi({
      action:"updateActivity",activityId:value(activity,"activityId"),
      name:form.get("name"),defaultDurationSeconds:Number(form.get("durationMinutes"))*60,
      defaultTransitionSeconds:Number(form.get("transitionSeconds"))
    }));
    if(data){await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function setActivityStatus(activity:Entity,status:"inactive"|"active"){
    if(status==="inactive"&&!window.confirm(`Delete ${value(activity,"name")}? It can be restored later.`))return;
    const data=await run(status==="inactive"?"Activity deleted and recoverable.":"Activity restored.",()=>hostApi({
      action:"updateActivity",activityId:value(activity,"activityId"),status
    }));
    if(data){await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function createHost(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);
    const password=String(form.get("password")||"");
    if(password!==String(form.get("confirmPassword")||"")){setError("The passwords do not match.");return;}
    const role=form.get("role")==="superhost"?"superhost":"host";
    const data=await run(`${role==="superhost"?"Superhost":"Host"} user created with a permanent password.`,()=>hostApi({action:"createHost",role,username:form.get("username"),displayName:form.get("displayName"),email:form.get("email"),password}));
    if(data){formElement.reset();await refreshAdmin();}
  }

  async function updateHost(event:FormEvent<HTMLFormElement>,userId:string){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const data=await run("Host account updated.",()=>hostApi({
      action:"updateHost",userId,displayName:form.get("displayName"),
      username:form.get("username"),email:form.get("email")
    }));
    if(data)await refreshAdmin();
  }

  async function setHostPassword(event:FormEvent<HTMLFormElement>,userId:string){
    event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);
    const password=String(form.get("password")||"");
    if(password!==String(form.get("confirmPassword")||"")){setError("The passwords do not match.");return;}
    const data=await run("The permanent password was replaced and previous sessions were signed out.",()=>hostApi({action:"setHostPassword",userId,password}));
    if(data){formElement.reset();await refreshAdmin();}
  }

  async function updateActivityLanguages(event:FormEvent<HTMLFormElement>,activity:Entity){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const allowedLanguages=selectedLanguages(form);
    if(!allowedLanguages.length){setError("Select at least one guest language.");return;}
    const data=await run("Activity languages updated.",()=>hostApi({
      action:"updateActivityLanguages",hotelId:value(activity,"hotelId"),
      venueId:value(activity,"venueId"),activityId:value(activity,"activityId"),allowedLanguages
    }));
    if(data){await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function assignHost(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const preset=String(form.get("permissionPreset")||"operator");
    const permissions=preset==="manager"?{all:true}:preset==="viewer"?{
      canViewHistory:true,canViewReviews:true,canViewQR:true,canCopyPublicLink:true
    }:{
      canStartActivity:true,canFinishActivity:true,canStartNewActivity:true,
      canArchiveQueue:true,canOpenCloseRequests:true,canChangeSchedule:true,
      canChangeDuration:true,canChangeTransition:true,canShowHidePublicStatus:true,
      canControlVirtualDJ:true,canViewHistory:true,canViewReviews:true,
      canViewQR:true,canDownloadQR:true,canCopyPublicLink:true,canScheduleNextActivity:true
    };
    const data=await run("User assigned to the hotel.",()=>hostApi({
      action:"assignUser",userId:form.get("userId"),hotelId:form.get("hotelId"),
      permissions
    }));
    if(data){await refreshAdmin();}
  }

  async function logout(){
    try{await hostApi({action:"logout"});}catch{/* Session is cleared locally even if upstream is unavailable. */}
    setUser(null);setSelection(EMPTY_SELECTION);setSelected(null);setAdmin(null);setGoogleFallback(null);
  }

  if(loading)return <main className="hostPage"><section className="hostCard loadingCard"><RefreshCw className="spin"/>Loading secure Host Panel…</section></main>;
  if(!user)return <main className="hostPage"><section className="hostLogin hostCard">
    <div className="hostMark"><ShieldCheck/></div><p className="hostEyebrow">GUEST STAR 4.2</p><h1>Host Panel</h1>
    <p>Sign in with the account created by your Superhost.</p>
    <form onSubmit={login}><label>Username or email<input name="username" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}><KeyRound/>Sign In</button></form>
    <p className="hostSetupHelp">Forgot your username or password, or having trouble signing in? <strong>Contact your Superhost.</strong></p>
    {error&&<p className="hostError" role="alert">{error}</p>}
  </section></main>;
  if(user.mustChangePassword)return <main className="hostPage"><section className="hostLogin hostCard">
    <div className="hostMark"><KeyRound/></div><p className="hostEyebrow">SECURITY REQUIRED</p><h1>Set Your Permanent Password</h1><p>Replace the initial password before continuing.</p>
    <form onSubmit={changePassword}><label>Current password<input name="currentPassword" type="password" required/></label><label>New permanent password<input name="newPassword" type="password" minLength={12} required/></label><label>Confirm new password<input name="confirmPassword" type="password" minLength={12} required/></label><button disabled={busy}>Update Password</button></form>{error&&<p className="hostError">{error}</p>}
  </section></main>;

  const selectedActivity=selected?.activity as Entity|undefined;
  const selectedState=selected?.state as Entity|undefined;
  const accepting=selectedState?.accepting!==false;
  const publicStatusVisible=selectedState?.showPublicStatus===true;
  const adminHotels=(admin?.hotels as Entity[]|undefined)||[];
  const activeAdminHotels=adminHotels.filter(item=>value(item,"status")==="active");
  const adminVenues=(admin?.venues as Entity[]|undefined)||[];
  const activeAdminVenues=adminVenues.filter(item=>value(item,"status")==="active");
  const adminActivities=(admin?.activities as Entity[]|undefined)||[];
  const adminUsers=(admin?.users as User[]|undefined)||[];
  const assignableUsers=adminUsers.filter(item=>item.role==="host"&&value(item,"status")!=="inactive");
  const adminAssignments=(admin?.assignments as Entity[]|undefined)||[];
  const adminDevices=(admin?.devices as Entity[]|undefined)||[];
  const activeAdminDevices=adminDevices.filter(item=>value(item,"status")==="active");
  const revokedAdminDevices=adminDevices.filter(item=>value(item,"status")!=="active");
  const onlineAdminDevices=activeAdminDevices.filter(item=>String(item.virtualDJConnected)==="true");
  const auditEntries=((admin?.auditLog as Entity[]|undefined)||[]).slice(-25).reverse();
  const brandingRecords=(admin?.branding as Entity[]|undefined)||[];
  const currentBranding=brandingRecords.find(item=>value(item,"hotelId")===hotelId)||{};
  const currentLocalizedMessages=localizedMessages(currentBranding);
  const activityHotelId=activeAdminHotels.some(item=>value(item,"hotelId")===newActivityHotelId)
    ?newActivityHotelId:value(activeAdminHotels[0],"hotelId");
  const activityVenues=activeAdminVenues.filter(item=>value(item,"hotelId")===activityHotelId);
  const googleAssets=(googleFallback?.assets as GoogleFallbackAsset[]|undefined)||[];
  const googleSnapshots=(googleFallback?.snapshots as GoogleFallbackSnapshot[]|undefined)||[];
  const ownGoogleAsset=googleAssets.find(asset=>asset.userId===user.userId);
  const defaultGoogleFallback=(googleFallback?.defaultGoogleFallback as Entity|undefined)||
    (admin?.defaultGoogleFallback as Entity|undefined)||{};
  const googleFallbackEnabled=defaultGoogleFallback.enabled===true||String(defaultGoogleFallback.enabled)==="true";
  return <main className="hostPage">
    <header className="hostTop"><div><p className="hostEyebrow">GUEST STAR EXPERIENCE 4.3.4</p><h1>{user.role==="superhost"?"Superhost Administration":"Host Panel"}</h1><span>{user.displayName} · {user.role}{user.role==="superhost"&&codeVersion?` · Service v${codeVersion}`:""}</span></div><div className="entityLinks"><button onClick={()=>setShowOwnPasswordForm(value=>!value)}><KeyRound/>Change Password</button><button onClick={logout}><LogOut/>Log Out</button></div></header>
    {(notice||error)&&<div className={error?"hostNotice error":"hostNotice"}>{error||notice}</div>}
    {showOwnPasswordForm&&<section className="hostCard"><div className="sectionTitle"><KeyRound/><div><h2>Change Your Password</h2><p>Your current password is required. The new permanent password must contain at least 12 characters.</p></div></div><form className="inlineForm" onSubmit={changePassword}><input name="currentPassword" type="password" autoComplete="current-password" placeholder="Current password" required/><input name="newPassword" type="password" autoComplete="new-password" minLength={12} placeholder="New password" required/><input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} placeholder="Confirm new password" required/><button disabled={busy}>Save Password</button></form></section>}
    <section className="hostCard contextCard"><div className="sectionTitle"><Radio/><div><h2>Activity Controls</h2><p>Select only from the hotels and activities assigned to this account.</p></div></div>
      <div className="hostGrid three"><label>Hotel<select value={hotelId} onChange={event=>{setHotelId(event.target.value);setSelected(null);}}>{selection.hotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label><label>Venue<select value={venueId} onChange={event=>{setVenueId(event.target.value);setSelected(null);}}>{venues.map(item=><option key={value(item,"venueId")} value={value(item,"venueId")}>{value(item,"name")}</option>)}</select></label><label>Activity<select value={activityId} onChange={event=>{setActivityId(event.target.value);setSelected(null);}}>{activities.map(item=><option key={value(item,"activityId")} value={value(item,"activityId")}>{value(item,"name")}</option>)}</select></label></div>
      <button className="primaryAction" disabled={busy||!activityId} onClick={chooseActivity}>Load Activity</button>
      {selected&&<><div className="activityStrip"><div><small>ACTIVITY</small><strong>{value(selectedActivity,"name")}</strong></div><div><small>STATUS</small><strong>{value(selectedActivity,"status")||"ready"}</strong></div><div><small>REQUESTS</small><strong>{accepting?"Open":"Closed"}</strong></div></div><div className="activityButtons"><button onClick={()=>activityAction("startActivityV4","Activity started.")}><Play/>Start</button><button onClick={()=>{if(window.confirm("Finish this activity and close new requests?"))void activityAction("finishActivityV4","Activity finished.");}}><Square/>Finish</button><button onClick={()=>{if(window.confirm("Archive the previous cycle and start a new empty activity?"))void activityAction("startNewActivityV4","New activity cycle started.");}}><RefreshCw/>Start New</button><button onClick={()=>activityAction("toggleRequests",accepting?"Requests closed.":"Requests opened.",{open:!accepting})}>{accepting?"Close Requests":"Open Requests"}</button><button onClick={()=>activityAction("updateActivitySettings",publicStatusVisible?"Public activity status hidden.":"Public activity status visible.",{showPublicStatus:!publicStatusVisible})}>{publicStatusVisible?"Hide Public Status":"Show Public Status"}</button><button onClick={()=>{if(window.confirm("Archive and clear the active request queue?"))void activityAction("archiveClearQueue","Queue archived and cleared.");}}>Archive & Clear</button>{Boolean(selected.share)&&<a href={value(selected.share as Entity,"publicUrl")} target="_blank" rel="noreferrer"><Link2/>Public Link</a>}</div></>}
      {selected&&<div className="hostDetailsGrid">
        <details><summary>Request Languages</summary><form key={`${value(selectedActivity,"activityId")}-${value(selectedActivity,"updatedAt")}`} onSubmit={event=>updateActivityLanguages(event,selectedActivity||{})}><p>Choose any of the seven guest languages.</p><div className="hostGrid languageChoices">{GUEST_LANGUAGES.map(([code,label])=><label className="checkLine" key={code}><input name={`language_${code}`} type="checkbox" defaultChecked={activityLanguages(selectedActivity).includes(code)}/>{label}</label>)}</div><button disabled={busy}>Save Languages</button></form></details>
        <details><summary>Schedule and Recurrence</summary><form onSubmit={scheduleActivity}><label>Scheduled start<input name="scheduledStartAt" type="datetime-local" required/></label><div className="hostGrid three"><label>Duration minutes<input name="durationMinutes" type="number" min="15" defaultValue="120"/></label><label>Open requests minutes early<input name="openingLeadMinutes" type="number" min="0" defaultValue="60"/></label><label>Repeat<select name="recurrenceType" defaultValue="none"><option value="none">Do not repeat</option><option value="daily">Daily</option><option value="weekly">Every week</option><option value="biweekly">Every two weeks</option><option value="monthly">Every month</option></select></label></div><fieldset><legend>Days of the week (weekly or biweekly)</legend><div className="hostGrid weekdayChoices">{WEEKDAYS.map(([day,label])=><label className="checkLine" key={day}><input name={`weekday_${day}`} type="checkbox"/>{label}</label>)}</div></fieldset><label className="checkLine"><input name="autoOpenRequests" type="checkbox"/>Open requests automatically before start</label><label className="checkLine"><input name="autoStartActivity" type="checkbox"/>Start activity automatically at the scheduled time</label><label className="checkLine"><input name="showCountdown" type="checkbox" defaultChecked/>Show public countdown</label><button disabled={busy}><CalendarClock/>Save Schedule</button></form></details>
        <details><summary>Reviews</summary><button onClick={loadReviews}>Refresh Reviews</button><div className="reviewList">{reviews.map(review=><article key={value(review,"reviewId")}><strong>{"★".repeat(Number(review.rating)||0)} {value(review,"guestName")||"Anonymous guest"}</strong><p>{value(review,"comment")||"No comment"}</p><small>{value(review,"createdAt")}</small><div><button onClick={()=>reviewAction(value(review,"reviewId"),"archive")}>Archive</button><button onClick={()=>reviewAction(value(review,"reviewId"),"delete")}>Delete</button></div></article>)}</div></details>
      </div>}
      <details className="googleFallbackPanel"><summary>Google Form and Sheet Backup</summary>
        <p>One reusable Form and response Sheet is created for each Host. Starting a new activity or archiving the queue saves a dated copy and resets the same operational files automatically.</p>
        {googleFallback?.ok===false&&<p className="hostError">{String(googleFallback.error||"Google backup is not available yet.")}</p>}
        {!value(user,"email")&&<p className="hostError">Add an email to this Guest Star account before connecting Google Drive.</p>}
        {value(user,"email")&&googleClientId&&hotelId&&venueId&&activityId&&<div className="googleSignIn"><small>Google account required: {value(user,"email")}</small><div ref={googleButtonRef}/></div>}
        {value(user,"email")&&!googleClientId&&<p>{user.role==="superhost"?"Google Sign-In still needs its OAuth Client ID in Cloudflare.":"Google Sign-In has not been enabled by the Superhost yet."}</p>}
        {ownGoogleAsset&&<div className="googleAsset"><strong>Your operational backup</strong><small>{ownGoogleAsset.hotelName||"Hotel"} · {ownGoogleAsset.activityName||"Activity"}</small><div className="entityLinks"><a href={ownGoogleAsset.formUrl} target="_blank" rel="noreferrer"><ExternalLink/>Open Form</a><a href={ownGoogleAsset.sheetUrl} target="_blank" rel="noreferrer"><ExternalLink/>Open Sheet</a><a href={ownGoogleAsset.formEditUrl} target="_blank" rel="noreferrer"><ExternalLink/>Edit Form</a></div></div>}
        {user.role==="superhost"&&<>
          <h3>Host backup files</h3>
          {googleFallbackEnabled&&<div className="temporaryPassword"><strong>Google backup is active at request.gstarxp.com</strong><span>{value(defaultGoogleFallback,"hotelId")} · {value(defaultGoogleFallback,"activityId")}</span><button type="button" disabled={busy} onClick={()=>void disableGoogleFallbackAtRoot()}>Restore Guest Star at Root</button></div>}
          <div className="entityList compact">{googleAssets.map(asset=><article key={asset.userId}><div><strong>{asset.displayName||asset.email||"Host"}</strong><small>{asset.hotelName||"Hotel"} · {asset.activityName||"Activity"}</small><div className="entityLinks"><a href={asset.formUrl} target="_blank" rel="noreferrer">Form</a><a href={asset.sheetUrl} target="_blank" rel="noreferrer">Sheet</a><button type="button" disabled={busy||!asset.formUrl||!asset.activityId} onClick={()=>void useGoogleFallbackAtRoot(asset)}>{googleFallbackEnabled&&value(defaultGoogleFallback,"formUrl")===asset.formUrl?"Assigned to Root":"Use at Root"}</button></div></div></article>)}</div>
          {googleSnapshots.length>0&&<details><summary>Saved activity copies ({googleSnapshots.length})</summary><div className="entityList compact">{googleSnapshots.map(snapshot=><article key={snapshot.snapshotId||snapshot.snapshotUrl}><div><strong>{snapshot.displayName||"Host backup"}</strong><small>{snapshot.createdAt||""} · {snapshot.reason||"activity reset"}</small></div><a href={snapshot.snapshotUrl} target="_blank" rel="noreferrer"><ExternalLink/>Open Copy</a></article>)}</div></details>}
        </>}
      </details>
    </section>

    {user.role==="superhost"&&<section className="adminStack">
      <section className="hostCard"><div className="sectionTitle"><Hotel/><div><h2>Hotels and Permanent Links</h2><p>Create each hotel and manage its permanent guest link and QR code.</p></div></div>
        <form className="inlineForm" onSubmit={createHotel}><input name="name" placeholder="Hotel name" required/><input name="timezone" defaultValue="America/Santo_Domingo" placeholder="Timezone" required/><button disabled={busy}><Plus/>Create Hotel</button></form>
        <DefaultPublicExperienceForm hotels={adminHotels} venues={adminVenues} activities={adminActivities} current={(admin?.defaultPublicExperience as Entity|undefined)||{}} busy={busy} onSave={saveDefaultPublicExperience}/>
        <div className="entityList">{adminHotels.map(item=><article key={value(item,"hotelId")}><div><strong>{value(item,"name")}</strong><small>{value(item,"timezone")} · {value(item,"status")}</small></div><div className="entityLinks"><a href={value(item,"publicUrl")} target="_blank" rel="noreferrer"><ExternalLink/>Public Page</a>{hotelQrPngUrl(item)&&<a href={hotelQrPngUrl(item)} target="_blank" rel="noreferrer"><ExternalLink/>QR PNG</a>}<button onClick={async()=>{await run("Hotel QR regenerated.",()=>hostApi({action:"regenerateHotelQr",hotelId:value(item,"hotelId")}));await refreshAdmin();}}>Regenerate QR</button><button onClick={async()=>{const inactive=value(item,"status")==="inactive";let confirmHotelName="";if(!inactive){confirmHotelName=window.prompt(`Type ${value(item,"name")} exactly to delete this hotel:`,"")||"";if(confirmHotelName!==value(item,"name"))return;}await run(inactive?"Hotel restored.":"Hotel deleted and recoverable.",()=>hostApi({action:"updateHotel",hotelId:value(item,"hotelId"),status:inactive?"active":"inactive",confirmHotelName}));await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}}>{value(item,"status")==="inactive"?"Restore":"Delete"}</button></div></article>)}</div>
      </section>
      <div className="adminColumns">
        <section className="hostCard"><div className="sectionTitle"><MapPin/><div><h2>Venue Administration</h2><p>Create, rename, delete or restore physical locations inside each hotel.</p></div></div>
          <details><summary>Create venue</summary><form onSubmit={createVenue}><label>Hotel<select name="hotelId" required>{activeAdminHotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label><label>Venue name<input name="name" required/></label><button disabled={busy||!activeAdminHotels.length}><Plus/>Create Venue</button></form></details>
          <div className="entityList compact">{activeAdminVenues.map(item=>{const linkedActivities=adminActivities.filter(activity=>value(activity,"venueId")===value(item,"venueId")&&value(activity,"status")!=="inactive").length;return <article key={value(item,"venueId")}><div><strong>{value(item,"name")}</strong><small>{adminHotels.find(hotel=>value(hotel,"hotelId")===value(item,"hotelId"))?.name||"Hotel"} · {linkedActivities} active {linkedActivities===1?"activity":"activities"}</small><details><summary>Manage venue</summary><form onSubmit={event=>updateVenueRecord(event,item)}><label>Venue name<input name="name" defaultValue={value(item,"name")} required/></label><button disabled={busy}>Save Venue</button></form><button className="dangerAction" disabled={busy} onClick={()=>void setVenueStatus(item,"inactive")}>Delete Venue</button></details></div></article>;})}</div>
          {adminVenues.some(item=>value(item,"status")==="inactive")&&<details><summary>Deleted venues</summary><div className="entityList compact">{adminVenues.filter(item=>value(item,"status")==="inactive").map(item=><article key={value(item,"venueId")}><div><strong>{value(item,"name")}</strong><small>{adminHotels.find(hotel=>value(hotel,"hotelId")===value(item,"hotelId"))?.name||"Hotel"} · Inactive · recoverable</small></div><button disabled={busy} onClick={()=>void setVenueStatus(item,"active")}>Restore</button></article>)}</div></details>}
        </section>
        <section className="hostCard"><div className="sectionTitle"><CalendarClock/><div><h2>Activities</h2><p>Create, edit or recover activities. Advanced options stay folded until needed.</p></div></div>
          <details><summary>Create activity</summary><form onSubmit={createActivity}><label>Hotel<select name="hotelId" value={activityHotelId} onChange={event=>setNewActivityHotelId(event.target.value)} required>{activeAdminHotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label><label>Venue / location<select key={activityHotelId} name="venueId" required disabled={!activityVenues.length}>{activityVenues.map(item=><option key={value(item,"venueId")} value={value(item,"venueId")}>{value(item,"name")}</option>)}</select></label>{!activityVenues.length&&<small>Create an active venue for this hotel before creating the activity.</small>}<label>Activity name<input name="name" required/></label><div className="hostGrid two"><label>Minutes<input name="durationMinutes" type="number" defaultValue="120" min="15"/></label><label>Transition seconds<input name="transitionSeconds" type="number" defaultValue="30" min="0" max="900"/></label></div><fieldset><legend>Guest languages</legend><div className="hostGrid languageChoices">{GUEST_LANGUAGES.map(([code,label])=><label className="checkLine" key={code}><input name={`language_${code}`} type="checkbox" defaultChecked/>{label}</label>)}</div></fieldset><button disabled={busy||!activityVenues.length}><Plus/>Create Activity</button></form></details>
          <div className="entityList compact">{adminActivities.filter(item=>value(item,"status")!=="inactive").map(item=>{const languages=activityLanguages(item);const activityVenue=adminVenues.find(venue=>value(venue,"venueId")===value(item,"venueId"));return <article key={value(item,"activityId")}><div><strong>{value(item,"name")}</strong><small>{adminHotels.find(hotel=>value(hotel,"hotelId")===value(item,"hotelId"))?.name||"Hotel"} · {value(activityVenue,"name")||"Venue"} · {languages.length} languages</small><details><summary>Edit</summary><form onSubmit={event=>updateActivityRecord(event,item)}><label>Name<input name="name" defaultValue={value(item,"name")} required/></label><label>Venue<input value={value(activityVenue,"name")||"Venue unavailable"} readOnly/></label><div className="hostGrid two"><label>Minutes<input name="durationMinutes" type="number" min="15" defaultValue={Math.max(15,Number(item.defaultDurationSeconds||7200)/60)}/></label><label>Transition seconds<input name="transitionSeconds" type="number" min="0" max="900" defaultValue={Number(item.defaultTransitionSeconds??30)}/></label></div><button disabled={busy}>Save Activity</button></form><form onSubmit={event=>updateActivityLanguages(event,item)}><fieldset><legend>Guest languages</legend><div className="hostGrid languageChoices">{GUEST_LANGUAGES.map(([code,label])=><label className="checkLine" key={code}><input name={`language_${code}`} type="checkbox" defaultChecked={languages.includes(code)}/>{label}</label>)}</div></fieldset><button disabled={busy}>Save Languages</button></form><button className="dangerAction" disabled={busy} onClick={()=>void setActivityStatus(item,"inactive")}>Delete Activity</button></details></div></article>;})}</div>
          {adminActivities.some(item=>value(item,"status")==="inactive")&&<details><summary>Deleted activities</summary><div className="entityList compact">{adminActivities.filter(item=>value(item,"status")==="inactive").map(item=><article key={value(item,"activityId")}><div><strong>{value(item,"name")}</strong><small>Inactive · recoverable</small></div><button disabled={busy} onClick={()=>void setActivityStatus(item,"active")}>Restore</button></article>)}</div></details>}
        </section>
      </div>
      <div className="adminColumns">
        <section className="hostCard"><div className="sectionTitle"><UserPlus/><div><h2>Users and Superhosts</h2><p>Create permanent Host or Superhost accounts. Stored passwords remain one-way hashed.</p></div></div><details><summary>Create user</summary><form onSubmit={createHost}><label>Role<select name="role" defaultValue="host"><option value="host">Host</option><option value="superhost">Superhost</option></select></label><label>Display name<input name="displayName" required/></label><label>Username<input name="username" required/></label><label>Email (optional)<input name="email" type="email"/></label><label>Permanent password<input name="password" type="password" autoComplete="new-password" minLength={12} required/></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required/></label><button disabled={busy}><UserPlus/>Create User</button></form></details><div className="entityList compact">{adminUsers.map(item=><article key={item.userId}><div><strong>{item.displayName}</strong><small>{item.role} · {value(item,"status")||"—"} · Last sign-in: {value(item,"lastLoginAt")||"—"}</small><details><summary>Manage account</summary><form onSubmit={event=>updateHost(event,item.userId)}><label>Display name<input name="displayName" defaultValue={item.displayName} required/></label><label>Username<input name="username" defaultValue={item.username} required/></label><label>Email<input name="email" type="email" defaultValue={value(item,"email")}/></label><small>Password last changed: {value(item,"passwordUpdatedAt")||"—"}</small><button disabled={busy}>Save User</button></form><form onSubmit={event=>setHostPassword(event,item.userId)}><label>New permanent password<input name="password" type="password" autoComplete="new-password" minLength={12} required/></label><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required/></label><button disabled={busy}>Replace Password</button></form><button onClick={async()=>{const inactive=value(item,"status")==="inactive";if(!inactive&&!window.confirm(`Deactivate this ${item.role} and revoke all sessions and devices?`))return;await run(inactive?"User activated.":"User deactivated.",()=>hostApi({action:"updateHost",userId:item.userId,status:inactive?"active":"inactive"}));await refreshAdmin();}}>{value(item,"status")==="inactive"?"Activate":"Deactivate"}</button></details></div></article>)}</div></section>
        <section className="hostCard"><div className="sectionTitle"><Users/><div><h2>Assignments</h2><p>Assignments apply only to Host accounts; Superhosts already have global access.</p></div></div><details><summary>Create assignment</summary><form onSubmit={assignHost}><label>User<select name="userId">{assignableUsers.map(item=><option key={item.userId} value={item.userId}>{item.displayName} ({item.username})</option>)}</select></label><label>Hotel<select name="hotelId">{activeAdminHotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label><label>Permission preset<select name="permissionPreset" defaultValue="operator"><option value="operator">Activity Operator</option><option value="manager">Hotel Manager</option><option value="viewer">Read Only</option></select></label><button disabled={busy||!assignableUsers.length}><Building2/>Create Assignment</button></form></details><div className="entityList compact">{adminAssignments.filter(item=>value(item,"status")==="active").map(item=><article key={value(item,"assignmentId")}><div><strong>{adminUsers.find(userItem=>userItem.userId===value(item,"userId"))?.displayName||"Host"}</strong><small>{adminHotels.find(hotelItem=>value(hotelItem,"hotelId")===value(item,"hotelId"))?.name||"Hotel"}</small></div><button onClick={async()=>{if(!window.confirm("Revoke this assignment?"))return;await run("Assignment revoked.",()=>hostApi({action:"revokeAssignment",assignmentId:value(item,"assignmentId")}));await refreshAdmin();}}>Revoke</button></article>)}</div></section>
      </div>
      <div className="adminColumns">
        <section className="hostCard"><div className="sectionTitle"><ShieldCheck/><div><h2>Hotel Branding and Public Experience</h2><p>Messages translate once when saved and load instantly for guests.</p></div></div>
          <div className="activityStrip"><div><small>HOTEL</small><strong>{adminHotels.find(item=>value(item,"hotelId")===hotelId)?.name||"Select a hotel"}</strong></div><div><small>TEAM</small><strong>{value(currentBranding,"teamDisplayName")||"Not configured"}</strong></div><div><small>LANGUAGE</small><strong>{GUEST_LANGUAGES.find(([code])=>code===(value(currentBranding,"messageSourceLanguage")||"en"))?.[1]||"English"}</strong></div></div>
          <details><summary>Configure branding and public experience</summary><form key={`${hotelId}-${value(currentBranding,"updatedAt")}`} onSubmit={saveBranding}><div className="hostGrid two"><label>Team display name<input name="teamDisplayName" defaultValue={value(currentBranding,"teamDisplayName")}/></label><label>Team type<input name="teamType" defaultValue={value(currentBranding,"teamType")}/></label></div><label>Tagline<input name="tagline" defaultValue={value(currentBranding,"tagline")}/></label><details><summary>Logos and colors</summary><div className="hostGrid two"><label>Hotel logo URL<input name="hotelLogoUrl" type="url" defaultValue={value(currentBranding,"hotelLogoUrl")}/></label><label>Team logo URL<input name="teamLogoUrl" type="url" defaultValue={value(currentBranding,"teamLogoUrl")}/></label></div><div className="hostGrid three"><label>Primary color<input name="primaryColor" type="color" defaultValue={value(currentBranding,"primaryColor")||"#ff2d95"}/></label><label>Secondary color<input name="secondaryColor" type="color" defaultValue={value(currentBranding,"secondaryColor")||"#8b3dff"}/></label><label>Accent color<input name="accentColor" type="color" defaultValue={value(currentBranding,"accentColor")||"#00c8ff"}/></label></div></details><div className="hostGrid two"><label>Original message language<select name="messageSourceLanguage" defaultValue={value(currentBranding,"messageSourceLanguage")||"en"}>{GUEST_LANGUAGES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label><label>Translation<select name="translationMode" defaultValue={value(currentBranding,"translationMode")||"auto"}><option value="auto">Automatic · free quota only</option><option value="manual">Manual by language</option></select></label></div><small>Translation status: {value(currentBranding,"translationStatus")||"not generated"}. No paid fallback is enabled.</small>{BRANDING_MESSAGES.map(([field,label])=><label key={field}>{label}<input name={field} maxLength={300} defaultValue={value(currentBranding,field)}/></label>)}<details><summary>Manual translations by language</summary><p>Use these fields only when you select manual translation or want to override a language.</p>{GUEST_LANGUAGES.map(([code,label])=><details key={code}><summary>{label}</summary>{BRANDING_MESSAGES.map(([field,messageLabel])=><label key={field}>{messageLabel}<input name={`manual_${code}_${field}`} maxLength={300} defaultValue={currentLocalizedMessages[code]?.[field]||""}/></label>)}</details>)}</details><details><summary>Reviews and optional modules</summary><div className="hostGrid two"><label>External review provider<input name="externalReviewProvider" defaultValue={value(currentBranding,"externalReviewProvider")}/></label><label>External review URL<input name="externalReviewUrl" type="url" defaultValue={value(currentBranding,"externalReviewUrl")}/></label></div>{[["showHotelName","Show hotel name"],["showHotelLogo","Show hotel logo"],["showTeamIdentity","Show team identity"],["showActivityDetails","Show activity details"],["showCountdown","Show countdown"],["showNextActivity","Show next activity"],["showAddToCalendar","Show Add to Calendar"],["showInternalRating","Offer internal review"],["showExternalReview","Show external review link"],["showRemindMe","Offer Remind Me"],["offerFollowUp","Offer one review follow-up"]].map(([name,label])=><label className="checkLine" key={name}><input name={name} type="checkbox" defaultChecked={currentBranding[name]===true||String(currentBranding[name])==="true"}/>{label}</label>)}</details><button disabled={busy}>Save Guest Experience</button></form></details>
        </section>
        <section className="hostCard"><div className="sectionTitle"><Radio/><div><h2>Bridge Devices</h2><p>Live status is reported automatically by each authorized Bridge.</p></div></div>
          <div className="activityStrip"><div><small>ACTIVE</small><strong>{activeAdminDevices.length}</strong></div><div><small>VDJ ONLINE</small><strong>{onlineAdminDevices.length}</strong></div><div><small>REVOKED</small><strong>{revokedAdminDevices.length}</strong></div></div>
          <details><summary>Manage Bridge devices ({adminDevices.length})</summary>{!activeAdminDevices.length&&<p>No active Bridge devices.</p>}<div className="entityList compact">{activeAdminDevices.map(device=><article key={value(device,"deviceId")}><div><strong>{value(device,"deviceName")}</strong><small>Bridge {value(device,"bridgeVersion")} · VDJ {String(device.virtualDJConnected)==="true"?"online":"offline"}</small><small>Last heartbeat: {value(device,"lastHeartbeatAt")||"never"}</small></div><button onClick={async()=>{await run("Device revoked.",()=>hostApi({action:"revokeDevice",deviceId:value(device,"deviceId")}));await refreshAdmin();}}>Revoke</button></article>)}</div>{Boolean(revokedAdminDevices.length)&&<details><summary>Revoked devices ({revokedAdminDevices.length})</summary><div className="entityList compact">{revokedAdminDevices.map(device=><article key={value(device,"deviceId")}><div><strong>{value(device,"deviceName")}</strong><small>Revoked · Bridge {value(device,"bridgeVersion")}</small><small>Last heartbeat: {value(device,"lastHeartbeatAt")||"never"}</small></div></article>)}</div></details>}</details>
          <details><summary>Recent audit log ({auditEntries.length})</summary><div className="auditList">{auditEntries.map(entry=><div key={value(entry,"logId")}><strong>{value(entry,"action")}</strong><span>{value(entry,"createdAt")}</span></div>)}</div></details>
        </section>
      </div>
    </section>}
  </main>;
}
