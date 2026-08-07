"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2, CalendarClock, ExternalLink, Hotel, KeyRound, Link2,
  LogOut, MapPin, Play, Plus, Radio, RefreshCw, ShieldCheck, Square,
  UserPlus, Users
} from "lucide-react";

type RecordValue = string | number | boolean | null | undefined;
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

const EMPTY_SELECTION: Selection = { hotels: [], venues: [], activities: [] };

async function hostApi(payload: Record<string, unknown>): Promise<HostResponse> {
  const response = await fetch("/api/host", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({})) as HostResponse;
  if (!response.ok || data.ok === false) {
    const error = new Error(String(data.error || data.code || "The action could not be completed."));
    Object.assign(error, data);
    throw error;
  }
  return data;
}

function value(entity: Entity | undefined, field: string) {
  return String(entity?.[field] || "");
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
  const [temporaryPassword,setTemporaryPassword]=useState("");
  const [reviews,setReviews]=useState<Entity[]>([]);

  const refreshAdmin=useCallback(async(currentUser:User|null=user)=>{
    if(currentUser?.role!=="superhost")return;
    setAdmin(await hostApi({action:"adminState"}));
  },[user]);

  const acceptIdentity=useCallback(async(data:HostResponse)=>{
    const nextUser=data.user||null;
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
        if(oneTimeCode)window.history.replaceState({},"","/host");
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

  const venues=useMemo(()=>selection.venues.filter(item=>value(item,"hotelId")===hotelId),[selection,hotelId]);
  const activities=useMemo(()=>selection.activities.filter(item=>value(item,"hotelId")===hotelId&&value(item,"venueId")===venueId),[selection,hotelId,venueId]);
  const context={hotelId,venueId,activityId,source:"web"};

  async function run(label:string,operation:()=>Promise<HostResponse>){
    setBusy(true);setError("");setNotice("");
    try{
      const data=await operation();
      if(data.activity&&data.state)setSelected(data);
      setNotice(label);
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
    await run("Password updated.",()=>hostApi({action:"changePassword",currentPassword:form.get("currentPassword"),newPassword:next}));
    await acceptIdentity(await hostApi({action:"me"}));
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
    await run("Activity schedule saved.",()=>hostApi({
      action:"scheduleActivity",...context,scheduledLocal:local,
      durationSeconds:Number(form.get("durationMinutes"))*60,
      requestOpeningLeadSeconds:Number(form.get("openingLeadMinutes"))*60,
      autoOpenRequests:form.get("autoOpenRequests")==="on",
      autoStartActivity:form.get("autoStartActivity")==="on",
      showCountdown:form.get("showCountdown")==="on",
      recurrenceType:form.get("recurrenceType"),recurrenceInterval:Number(form.get("recurrenceInterval"))||1
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
    const branding={
      teamDisplayName:form.get("teamDisplayName"),teamType:form.get("teamType"),tagline:form.get("tagline"),
      hotelLogoUrl:form.get("hotelLogoUrl"),teamLogoUrl:form.get("teamLogoUrl"),
      primaryColor:form.get("primaryColor"),secondaryColor:form.get("secondaryColor"),accentColor:form.get("accentColor"),
      welcomeMessage:form.get("welcomeMessage"),inProgressTitle:form.get("inProgressTitle"),
      inProgressMessage:form.get("inProgressMessage"),activityFinishedMessage:form.get("activityFinishedMessage"),
      upcomingActivityMessage:form.get("upcomingActivityMessage"),reviewInvitationMessage:form.get("reviewInvitationMessage"),
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
    const data=await run("Hotel created. Its independent Google Sheet and permanent link are ready.",()=>hostApi({action:"createHotel",name:form.get("name"),timezone:form.get("timezone")}));
    if(data){formElement.reset();await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function createVenue(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);
    const data=await run("Venue created.",()=>hostApi({action:"createVenue",hotelId:form.get("hotelId"),name:form.get("name")}));
    if(data){formElement.reset();await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function createActivity(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);
    const data=await run("Activity created.",()=>hostApi({
      action:"createActivity",hotelId:form.get("hotelId"),venueId:form.get("venueId"),name:form.get("name"),
      defaultDurationSeconds:Number(form.get("durationMinutes"))*60,
      defaultTransitionSeconds:Number(form.get("transitionSeconds")),showCountdown:true
    }));
    if(data){formElement.reset();await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}
  }

  async function createHost(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);
    const data=await run("Host user created.",()=>hostApi({action:"createHost",username:form.get("username"),displayName:form.get("displayName"),email:form.get("email")}));
    if(data){setTemporaryPassword(String(data.temporaryPassword||""));formElement.reset();await refreshAdmin();}
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
    setUser(null);setSelection(EMPTY_SELECTION);setSelected(null);setAdmin(null);
  }

  if(loading)return <main className="hostPage"><section className="hostCard loadingCard"><RefreshCw className="spin"/>Loading secure Host Panel…</section></main>;
  if(!user)return <main className="hostPage"><section className="hostLogin hostCard">
    <div className="hostMark"><ShieldCheck/></div><p className="hostEyebrow">GUEST STAR 4.0</p><h1>Host Panel</h1>
    <p>Sign in with the account created by your Superhost. Google credentials are never required here.</p>
    <form onSubmit={login}><label>Username or email<input name="username" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}><KeyRound/>Sign In</button></form>
    {error&&<p className="hostError" role="alert">{error}</p>}
  </section></main>;
  if(user.mustChangePassword)return <main className="hostPage"><section className="hostLogin hostCard">
    <div className="hostMark"><KeyRound/></div><p className="hostEyebrow">SECURITY REQUIRED</p><h1>Set Your Password</h1><p>Your temporary password must be replaced before continuing.</p>
    <form onSubmit={changePassword}><label>Temporary password<input name="currentPassword" type="password" required/></label><label>New password<input name="newPassword" type="password" minLength={12} required/></label><label>Confirm new password<input name="confirmPassword" type="password" minLength={12} required/></label><button disabled={busy}>Update Password</button></form>{error&&<p className="hostError">{error}</p>}
  </section></main>;

  const selectedActivity=selected?.activity as Entity|undefined;
  const selectedState=selected?.state as Entity|undefined;
  const accepting=selectedState?.accepting!==false;
  const publicStatusVisible=selectedState?.showPublicStatus===true;
  const adminHotels=(admin?.hotels as Entity[]|undefined)||[];
  const activeAdminHotels=adminHotels.filter(item=>value(item,"status")!=="inactive");
  const adminVenues=(admin?.venues as Entity[]|undefined)||[];
  const adminUsers=((admin?.users as User[]|undefined)||[]).filter(item=>item.role!=="superhost");
  const adminAssignments=(admin?.assignments as Entity[]|undefined)||[];
  const adminDevices=(admin?.devices as Entity[]|undefined)||[];
  const auditEntries=((admin?.auditLog as Entity[]|undefined)||[]).slice(-25).reverse();
  const brandingRecords=(admin?.branding as Entity[]|undefined)||[];
  const currentBranding=brandingRecords.find(item=>value(item,"hotelId")===hotelId)||{};
  const activityHotelId=newActivityHotelId||value(activeAdminHotels[0],"hotelId");
  const activityVenues=adminVenues.filter(item=>value(item,"hotelId")===activityHotelId);

  return <main className="hostPage">
    <header className="hostTop"><div><p className="hostEyebrow">GUEST STAR EXPERIENCE 4.0</p><h1>{user.role==="superhost"?"Superhost Administration":"Host Panel"}</h1><span>{user.displayName} · {user.role}</span></div><button onClick={logout}><LogOut/>Log Out</button></header>
    {(notice||error)&&<div className={error?"hostNotice error":"hostNotice"}>{error||notice}</div>}
    <section className="hostCard contextCard"><div className="sectionTitle"><Radio/><div><h2>Activity Controls</h2><p>Select only from the hotels and activities assigned to this account.</p></div></div>
      <div className="hostGrid three"><label>Hotel<select value={hotelId} onChange={event=>{setHotelId(event.target.value);setSelected(null);}}>{selection.hotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label><label>Venue<select value={venueId} onChange={event=>{setVenueId(event.target.value);setSelected(null);}}>{venues.map(item=><option key={value(item,"venueId")} value={value(item,"venueId")}>{value(item,"name")}</option>)}</select></label><label>Activity<select value={activityId} onChange={event=>{setActivityId(event.target.value);setSelected(null);}}>{activities.map(item=><option key={value(item,"activityId")} value={value(item,"activityId")}>{value(item,"name")}</option>)}</select></label></div>
      <button className="primaryAction" disabled={busy||!activityId} onClick={chooseActivity}>Load Activity</button>
      {selected&&<><div className="activityStrip"><div><small>ACTIVITY</small><strong>{value(selectedActivity,"name")}</strong></div><div><small>STATUS</small><strong>{value(selectedActivity,"status")||"ready"}</strong></div><div><small>REQUESTS</small><strong>{accepting?"Open":"Closed"}</strong></div></div><div className="activityButtons"><button onClick={()=>activityAction("startActivityV4","Activity started.")}><Play/>Start</button><button onClick={()=>{if(window.confirm("Finish this activity and close new requests?"))void activityAction("finishActivityV4","Activity finished.");}}><Square/>Finish</button><button onClick={()=>{if(window.confirm("Archive the previous cycle and start a new empty activity?"))void activityAction("startNewActivityV4","New activity cycle started.");}}><RefreshCw/>Start New</button><button onClick={()=>activityAction("toggleRequests",accepting?"Requests closed.":"Requests opened.",{open:!accepting})}>{accepting?"Close Requests":"Open Requests"}</button><button onClick={()=>activityAction("updateActivitySettings",publicStatusVisible?"Public activity status hidden.":"Public activity status visible.",{showPublicStatus:!publicStatusVisible})}>{publicStatusVisible?"Hide Public Status":"Show Public Status"}</button><button onClick={()=>{if(window.confirm("Archive and clear the active request queue?"))void activityAction("archiveClearQueue","Queue archived and cleared.");}}>Archive & Clear</button>{Boolean(selected.share)&&<a href={value(selected.share as Entity,"publicUrl")} target="_blank" rel="noreferrer"><Link2/>Public Link</a>}</div></>}
      {selected&&<div className="hostDetailsGrid"><details><summary>Schedule and Recurrence</summary><form onSubmit={scheduleActivity}><label>Scheduled start<input name="scheduledStartAt" type="datetime-local" required/></label><div className="hostGrid three"><label>Duration minutes<input name="durationMinutes" type="number" min="15" defaultValue="120"/></label><label>Open requests minutes early<input name="openingLeadMinutes" type="number" min="0" defaultValue="60"/></label><label>Repeat<select name="recurrenceType" defaultValue="none"><option value="none">Do not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label></div><label>Repeat every<input name="recurrenceInterval" type="number" min="1" max="52" defaultValue="1"/></label><label className="checkLine"><input name="autoOpenRequests" type="checkbox"/>Open requests automatically before start</label><label className="checkLine"><input name="autoStartActivity" type="checkbox"/>Start activity automatically at the scheduled time</label><label className="checkLine"><input name="showCountdown" type="checkbox" defaultChecked/>Show public countdown</label><button disabled={busy}><CalendarClock/>Save Schedule</button></form></details><details><summary>Reviews</summary><button onClick={loadReviews}>Refresh Reviews</button><div className="reviewList">{reviews.map(review=><article key={value(review,"reviewId")}><strong>{"★".repeat(Number(review.rating)||0)} {value(review,"guestName")||"Anonymous guest"}</strong><p>{value(review,"comment")||"No comment"}</p><small>{value(review,"createdAt")}</small><div><button onClick={()=>reviewAction(value(review,"reviewId"),"archive")}>Archive</button><button onClick={()=>reviewAction(value(review,"reviewId"),"delete")}>Delete</button></div></article>)}</div></details></div>}
    </section>

    {user.role==="superhost"&&<section className="adminStack">
      <section className="hostCard"><div className="sectionTitle"><Hotel/><div><h2>Hotels and Independent Sheets</h2><p>Creating a hotel automatically creates its own spreadsheet in the Superhost’s Google Drive. Creating a user never creates a spreadsheet.</p></div></div>
        <form className="inlineForm" onSubmit={createHotel}><input name="name" placeholder="Hotel name" required/><input name="timezone" defaultValue="America/Santo_Domingo" placeholder="Timezone" required/><button disabled={busy}><Plus/>Create Hotel + Sheet</button></form>
        <div className="entityList">{adminHotels.map(item=><article key={value(item,"hotelId")}><div><strong>{value(item,"name")}</strong><small>{value(item,"timezone")} · {value(item,"status")}</small></div><div className="entityLinks"><a href={value(item,"publicUrl")} target="_blank" rel="noreferrer"><ExternalLink/>Public Page</a><a href={`https://docs.google.com/spreadsheets/d/${value(item,"dataSheetId")}/edit`} target="_blank" rel="noreferrer"><ExternalLink/>Hotel Sheet</a>{value(item,"qrFileId")&&<a href={`https://drive.google.com/uc?export=download&id=${encodeURIComponent(value(item,"qrFileId"))}`} target="_blank" rel="noreferrer"><ExternalLink/>QR PNG</a>}<button onClick={async()=>{await run("Hotel QR regenerated.",()=>hostApi({action:"regenerateHotelQr",hotelId:value(item,"hotelId")}));await refreshAdmin();}}>Regenerate QR</button><button onClick={async()=>{const inactive=value(item,"status")==="inactive";if(!inactive&&!window.confirm("Deactivate this hotel and its public link?"))return;await run(inactive?"Hotel activated.":"Hotel deactivated.",()=>hostApi({action:"updateHotel",hotelId:value(item,"hotelId"),status:inactive?"active":"inactive"}));await refreshAdmin();await acceptIdentity(await hostApi({action:"me"}));}}>{value(item,"status")==="inactive"?"Activate":"Deactivate"}</button></div></article>)}</div>
      </section>
      <div className="adminColumns">
        <section className="hostCard"><div className="sectionTitle"><MapPin/><div><h2>Venues</h2><p>Add physical locations inside a hotel.</p></div></div><form onSubmit={createVenue}><label>Hotel<select name="hotelId">{activeAdminHotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label><label>Venue name<input name="name" required/></label><button disabled={busy}><Plus/>Create Venue</button></form></section>
        <section className="hostCard"><div className="sectionTitle"><CalendarClock/><div><h2>Activities</h2><p>Create reusable activities for a venue.</p></div></div><form onSubmit={createActivity}><label>Hotel<select name="hotelId" value={activityHotelId} onChange={event=>setNewActivityHotelId(event.target.value)}>{activeAdminHotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label><label>Venue<select name="venueId">{activityVenues.map(item=><option key={value(item,"venueId")} value={value(item,"venueId")}>{value(item,"name")}</option>)}</select></label><label>Activity name<input name="name" required/></label><div className="hostGrid two"><label>Minutes<input name="durationMinutes" type="number" defaultValue="120" min="15"/></label><label>Transition seconds<input name="transitionSeconds" type="number" defaultValue="30" min="0" max="900"/></label></div><button disabled={busy||!activityVenues.length}><Plus/>Create Activity</button></form></section>
      </div>
      <div className="adminColumns">
        <section className="hostCard"><div className="sectionTitle"><UserPlus/><div><h2>Host Users</h2><p>Accounts are records in the master registry, not new Google files.</p></div></div><form onSubmit={createHost}><label>Display name<input name="displayName" required/></label><label>Username<input name="username" required/></label><label>Email (optional)<input name="email" type="email"/></label><button disabled={busy}><UserPlus/>Create Host</button></form>{temporaryPassword&&<div className="temporaryPassword"><strong>Temporary password — shown once</strong><code>{temporaryPassword}</code><button onClick={()=>navigator.clipboard.writeText(temporaryPassword)}>Copy</button></div>}<div className="entityList compact">{adminUsers.map(item=><article key={item.userId}><div><strong>{item.displayName}</strong><small>{item.username} · {value(item,"status")}</small></div><button onClick={async()=>{const inactive=value(item,"status")==="inactive";if(!inactive&&!window.confirm("Deactivate this host and revoke all sessions and devices?"))return;await run(inactive?"Host activated.":"Host deactivated.",()=>hostApi({action:"updateHost",userId:item.userId,status:inactive?"active":"inactive"}));await refreshAdmin();}}>{value(item,"status")==="inactive"?"Activate":"Deactivate"}</button></article>)}</div></section>
        <section className="hostCard"><div className="sectionTitle"><Users/><div><h2>Assignments</h2><p>Assign a host to one hotel. Server-side isolation remains enforced.</p></div></div><form onSubmit={assignHost}><label>User<select name="userId">{adminUsers.filter(item=>value(item,"status")!=="inactive").map(item=><option key={item.userId} value={item.userId}>{item.displayName} ({item.username})</option>)}</select></label><label>Hotel<select name="hotelId">{activeAdminHotels.map(item=><option key={value(item,"hotelId")} value={value(item,"hotelId")}>{value(item,"name")}</option>)}</select></label><label>Permission preset<select name="permissionPreset" defaultValue="operator"><option value="operator">Activity Operator</option><option value="manager">Hotel Manager</option><option value="viewer">Read Only</option></select></label><button disabled={busy}><Building2/>Create Assignment</button></form><div className="entityList compact">{adminAssignments.filter(item=>value(item,"status")==="active").map(item=><article key={value(item,"assignmentId")}><div><strong>{adminUsers.find(userItem=>userItem.userId===value(item,"userId"))?.displayName||"Host"}</strong><small>{adminHotels.find(hotelItem=>value(hotelItem,"hotelId")===value(item,"hotelId"))?.name||"Hotel"}</small></div><button onClick={async()=>{if(!window.confirm("Revoke this assignment?"))return;await run("Assignment revoked.",()=>hostApi({action:"revokeAssignment",assignmentId:value(item,"assignmentId")}));await refreshAdmin();}}>Revoke</button></article>)}</div></section>
      </div>
      <div className="adminColumns">
        <section className="hostCard"><div className="sectionTitle"><ShieldCheck/><div><h2>Hotel Branding and Public Experience</h2><p>Optional modules stay disabled unless you enable them here.</p></div></div><form key={`${hotelId}-${value(currentBranding,"updatedAt")}`} onSubmit={saveBranding}><div className="hostGrid two"><label>Team display name<input name="teamDisplayName" defaultValue={value(currentBranding,"teamDisplayName")}/></label><label>Team type<input name="teamType" defaultValue={value(currentBranding,"teamType")}/></label></div><label>Tagline<input name="tagline" defaultValue={value(currentBranding,"tagline")}/></label><div className="hostGrid two"><label>Hotel logo URL<input name="hotelLogoUrl" type="url" defaultValue={value(currentBranding,"hotelLogoUrl")}/></label><label>Team logo URL<input name="teamLogoUrl" type="url" defaultValue={value(currentBranding,"teamLogoUrl")}/></label></div><div className="hostGrid three"><label>Primary color<input name="primaryColor" type="color" defaultValue={value(currentBranding,"primaryColor")||"#ff2d95"}/></label><label>Secondary color<input name="secondaryColor" type="color" defaultValue={value(currentBranding,"secondaryColor")||"#8b3dff"}/></label><label>Accent color<input name="accentColor" type="color" defaultValue={value(currentBranding,"accentColor")||"#00c8ff"}/></label></div><label>Welcome message<input name="welcomeMessage" defaultValue={value(currentBranding,"welcomeMessage")}/></label><label>Live title<input name="inProgressTitle" defaultValue={value(currentBranding,"inProgressTitle")}/></label><label>Live message<input name="inProgressMessage" defaultValue={value(currentBranding,"inProgressMessage")}/></label><label>Finished message<input name="activityFinishedMessage" defaultValue={value(currentBranding,"activityFinishedMessage")}/></label><label>Upcoming activity message<input name="upcomingActivityMessage" defaultValue={value(currentBranding,"upcomingActivityMessage")}/></label><label>Review invitation<input name="reviewInvitationMessage" defaultValue={value(currentBranding,"reviewInvitationMessage")}/></label><div className="hostGrid two"><label>External review provider<input name="externalReviewProvider" defaultValue={value(currentBranding,"externalReviewProvider")}/></label><label>External review URL<input name="externalReviewUrl" type="url" defaultValue={value(currentBranding,"externalReviewUrl")}/></label></div>{[["showHotelName","Show hotel name"],["showHotelLogo","Show hotel logo"],["showTeamIdentity","Show team identity"],["showActivityDetails","Show activity details"],["showCountdown","Show countdown"],["showNextActivity","Show next activity"],["showAddToCalendar","Show Add to Calendar"],["showInternalRating","Offer internal review"],["showExternalReview","Show external review link"],["showRemindMe","Offer Remind Me"],["offerFollowUp","Offer one review follow-up"]].map(([name,label])=><label className="checkLine" key={name}><input name={name} type="checkbox" defaultChecked={currentBranding[name]===true||String(currentBranding[name])==="true"}/>{label}</label>)}<button disabled={busy}>Save Guest Experience</button></form></section>
        <section className="hostCard"><div className="sectionTitle"><Radio/><div><h2>Bridge Devices</h2><p>Live status is reported by each authorized Bridge.</p></div></div><div className="entityList compact">{adminDevices.map(device=><article key={value(device,"deviceId")}><div><strong>{value(device,"deviceName")}</strong><small>{value(device,"status")} · Bridge {value(device,"bridgeVersion")} · VDJ {String(device.virtualDJConnected)==="true"?"online":"offline"}</small><small>Last heartbeat: {value(device,"lastHeartbeatAt")||"never"}</small></div>{value(device,"status")==="active"&&<button onClick={async()=>{await run("Device revoked.",()=>hostApi({action:"revokeDevice",deviceId:value(device,"deviceId")}));await refreshAdmin();}}>Revoke</button>}</article>)}</div><h3>Recent Audit Log</h3><div className="auditList">{auditEntries.map(entry=><div key={value(entry,"logId")}><strong>{value(entry,"action")}</strong><span>{value(entry,"createdAt")}</span></div>)}</div></section>
      </div>
    </section>}
  </main>;
}
