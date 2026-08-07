import { setLocalQrImage } from "./qr-ui.js";

const COPY = {
  es: {
    title: "Panel Superhost",
    subtitle: "Administra toda la operación desde el Bridge.",
    tabs: {
      hotels: "Hoteles",
      operation: "Lugares, actividades y agenda",
      users: "Hosts y permisos",
      branding: "Experiencia pública",
      favorites: "Favoritos",
      devices: "Dispositivos y auditoría"
    },
    loading: "Cargando administración segura…",
    refresh: "Actualizar",
    createHotel: "Crear hotel",
    hotelName: "Nombre del hotel",
    timezone: "Zona horaria",
    activeHotels: "Hoteles activos",
    deletedHotels: "Hoteles eliminados",
    publicPage: "Página pública",
    copyLink: "Copiar enlace",
    copy: "Copiar",
    showQr: "Mostrar QR",
    deleteHotel: "Eliminar hotel",
    restoreHotel: "Restaurar hotel",
    noItems: "No hay registros en esta sección.",
    deletePrompt: "Para eliminar este hotel, escribe exactamente su nombre:",
    deleteMismatch: "El nombre no coincide. El hotel no fue eliminado.",
    createVenue: "Crear lugar",
    venueName: "Nombre del lugar",
    createActivity: "Crear actividad",
    activityName: "Nombre de la actividad",
    duration: "Duración (minutos)",
    transition: "Transición (segundos)",
    venues: "Lugares",
    activities: "Actividades",
    schedule: "Programar actividad",
    scheduledStart: "Fecha y hora",
    openingLead: "Abrir solicitudes minutos antes",
    recurrence: "Repetición",
    none: "No repetir",
    daily: "Diaria",
    weekly: "Semanal",
    monthly: "Mensual",
    autoOpen: "Abrir solicitudes automáticamente",
    autoStart: "Iniciar actividad automáticamente",
    countdown: "Mostrar cuenta regresiva",
    saveSchedule: "Guardar agenda",
    schedules: "Agenda",
    cancel: "Cancelar",
    reviews: "Reseñas",
    loadReviews: "Cargar reseñas",
    archive: "Archivar",
    delete: "Eliminar",
    createHost: "Crear Host",
    displayName: "Nombre visible",
    username: "Usuario",
    email: "Correo opcional",
    temporaryPassword: "Contraseña temporal — se muestra una sola vez",
    hosts: "Usuarios Host",
    activate: "Activar",
    deactivate: "Desactivar",
    assignments: "Asignaciones y permisos",
    assign: "Asignar",
    user: "Usuario",
    hotel: "Hotel",
    preset: "Nivel de permiso",
    operator: "Operador de actividad",
    manager: "Gerente del hotel",
    viewer: "Solo lectura",
    revoke: "Revocar",
    branding: "Identidad y experiencia pública",
    teamName: "Nombre del equipo",
    teamType: "Tipo de equipo",
    tagline: "Lema",
    hotelLogo: "URL del logo del hotel",
    teamLogo: "URL del logo del equipo",
    welcome: "Mensaje de bienvenida",
    liveTitle: "Título en vivo",
    liveMessage: "Mensaje en vivo",
    finishedMessage: "Mensaje al finalizar",
    upcomingMessage: "Mensaje de próxima actividad",
    reviewInvitation: "Invitación a reseña",
    externalProvider: "Proveedor de reseñas externo",
    externalUrl: "Enlace de reseñas externo",
    primaryColor: "Color principal",
    secondaryColor: "Color secundario",
    accentColor: "Color de acento",
    showHotelName: "Mostrar nombre del hotel",
    showHotelLogo: "Mostrar logo del hotel",
    showTeamIdentity: "Mostrar identidad del equipo",
    showActivityDetails: "Mostrar detalles de la actividad",
    showCountdown: "Mostrar cuenta regresiva",
    showNextActivity: "Mostrar próxima actividad",
    showAddToCalendar: "Mostrar Agregar al calendario",
    showInternalRating: "Ofrecer reseña interna",
    showExternalReview: "Mostrar reseña externa",
    showRemindMe: "Ofrecer Recordarme",
    offerFollowUp: "Ofrecer seguimiento de reseña",
    saveBranding: "Guardar experiencia pública",
    addFavorite: "Agregar favorito",
    song: "Canción",
    artist: "Artista",
    language: "Idioma",
    favoriteList: "Favoritos de este hotel",
    edit: "Editar",
    devices: "Dispositivos Bridge",
    lastHeartbeat: "Última señal",
    audit: "Auditoría reciente",
    saved: "Cambio guardado correctamente.",
    confirmDeactivate: "¿Desactivar este Host y revocar sus sesiones?",
    confirmRevoke: "¿Revocar este acceso?",
    confirmDeleteReview: "¿Eliminar esta reseña? La acción quedará auditada."
  },
  en: {
    title: "Superhost Panel",
    subtitle: "Manage the entire operation directly from Bridge.",
    tabs: {
      hotels: "Hotels",
      operation: "Venues, activities & schedule",
      users: "Hosts & permissions",
      branding: "Public experience",
      favorites: "Favorites",
      devices: "Devices & audit"
    },
    loading: "Loading secure administration…",
    refresh: "Refresh",
    createHotel: "Create hotel",
    hotelName: "Hotel name",
    timezone: "Time zone",
    activeHotels: "Active hotels",
    deletedHotels: "Deleted hotels",
    publicPage: "Public page",
    copyLink: "Copy link",
    copy: "Copy",
    showQr: "Show QR",
    deleteHotel: "Delete hotel",
    restoreHotel: "Restore hotel",
    noItems: "There are no records in this section.",
    deletePrompt: "To delete this hotel, type its exact name:",
    deleteMismatch: "The name does not match. The hotel was not deleted.",
    createVenue: "Create venue",
    venueName: "Venue name",
    createActivity: "Create activity",
    activityName: "Activity name",
    duration: "Duration (minutes)",
    transition: "Transition (seconds)",
    venues: "Venues",
    activities: "Activities",
    schedule: "Schedule activity",
    scheduledStart: "Date and time",
    openingLead: "Open requests minutes early",
    recurrence: "Repeat",
    none: "Do not repeat",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    autoOpen: "Open requests automatically",
    autoStart: "Start activity automatically",
    countdown: "Show countdown",
    saveSchedule: "Save schedule",
    schedules: "Schedule",
    cancel: "Cancel",
    reviews: "Reviews",
    loadReviews: "Load reviews",
    archive: "Archive",
    delete: "Delete",
    createHost: "Create Host",
    displayName: "Display name",
    username: "Username",
    email: "Optional email",
    temporaryPassword: "Temporary password — shown once",
    hosts: "Host users",
    activate: "Activate",
    deactivate: "Deactivate",
    assignments: "Assignments and permissions",
    assign: "Assign",
    user: "User",
    hotel: "Hotel",
    preset: "Permission level",
    operator: "Activity operator",
    manager: "Hotel manager",
    viewer: "Read only",
    revoke: "Revoke",
    branding: "Branding and public experience",
    teamName: "Team display name",
    teamType: "Team type",
    tagline: "Tagline",
    hotelLogo: "Hotel logo URL",
    teamLogo: "Team logo URL",
    welcome: "Welcome message",
    liveTitle: "Live title",
    liveMessage: "Live message",
    finishedMessage: "Finished message",
    upcomingMessage: "Upcoming activity message",
    reviewInvitation: "Review invitation",
    externalProvider: "External review provider",
    externalUrl: "External review URL",
    primaryColor: "Primary color",
    secondaryColor: "Secondary color",
    accentColor: "Accent color",
    showHotelName: "Show hotel name",
    showHotelLogo: "Show hotel logo",
    showTeamIdentity: "Show team identity",
    showActivityDetails: "Show activity details",
    showCountdown: "Show countdown",
    showNextActivity: "Show next activity",
    showAddToCalendar: "Show Add to Calendar",
    showInternalRating: "Offer internal review",
    showExternalReview: "Show external review",
    showRemindMe: "Offer Remind Me",
    offerFollowUp: "Offer review follow-up",
    saveBranding: "Save public experience",
    addFavorite: "Add favorite",
    song: "Song",
    artist: "Artist",
    language: "Language",
    favoriteList: "Favorites for this hotel",
    edit: "Edit",
    devices: "Bridge devices",
    lastHeartbeat: "Last heartbeat",
    audit: "Recent audit log",
    saved: "The change was saved successfully.",
    confirmDeactivate: "Deactivate this Host and revoke their sessions?",
    confirmRevoke: "Revoke this access?",
    confirmDeleteReview: "Delete this review? The action will be audited."
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function value(record, field) {
  return String(record?.[field] ?? "");
}

function checked(valueToCheck) {
  return valueToCheck === true || String(valueToCheck).toLowerCase() === "true";
}

function options(items, idField, label, selected = "") {
  return items.map((item) => {
    const id = value(item, idField);
    return `<option value="${escapeHtml(id)}"${id === selected ? " selected" : ""}>${escapeHtml(label(item))}</option>`;
  }).join("");
}

function permissionPreset(name) {
  if (name === "manager") return { all: true };
  if (name === "viewer") {
    return {
      canViewHistory: true,
      canViewReviews: true,
      canViewQR: true,
      canCopyPublicLink: true
    };
  }
  return {
    canStartActivity: true,
    canFinishActivity: true,
    canStartNewActivity: true,
    canArchiveQueue: true,
    canOpenCloseRequests: true,
    canChangeSchedule: true,
    canChangeDuration: true,
    canChangeTransition: true,
    canShowHidePublicStatus: true,
    canControlVirtualDJ: true,
    canViewHistory: true,
    canViewReviews: true,
    canViewQR: true,
    canDownloadQR: true,
    canCopyPublicLink: true,
    canScheduleNextActivity: true
  };
}

export function initSuperhostPanel({ api, showNotice, copyLink, openExternal }) {
  const main = document.querySelector("main");
  const workspace = document.querySelector("#superhostWorkspace");
  const content = document.querySelector("#superhostContent");
  const tabs = document.querySelector("#superhostTabs");
  const localNotice = document.querySelector("#superhostNotice");
  let language = "es";
  let activeTab = "hotels";
  let admin = null;
  let reviews = [];
  let temporaryPassword = "";
  let selectedBrandingHotel = "";
  let selectedFavoriteHotel = "";
  let selectedReviewActivity = "";
  let opened = false;
  let autoOpened = false;
  let loading = false;

  const text = () => COPY[language];

  function notify(message, error = false) {
    localNotice.textContent = message;
    localNotice.classList.remove("hidden", "error");
    if (error) localNotice.classList.add("error");
    showNotice(message, error);
  }

  async function requestAction(action, payload = {}) {
    return api("/api/superhost/action", {
      method: "POST",
      body: JSON.stringify({ action, ...payload })
    });
  }

  async function load() {
    if (loading) return;
    loading = true;
    content.innerHTML = `<section class="superhost-card"><p>${escapeHtml(text().loading)}</p></section>`;
    try {
      admin = await api("/api/superhost/state");
      const activeHotels = (admin.hotels || []).filter((hotel) => value(hotel, "status") === "active");
      const activeActivities = (admin.activities || []).filter((activity) => value(activity, "status") !== "inactive");
      selectedBrandingHotel ||= value(activeHotels[0], "hotelId");
      selectedFavoriteHotel ||= value(activeHotels[0], "hotelId");
      if (!activeActivities.some((activity) => value(activity, "activityId") === selectedReviewActivity)) {
        selectedReviewActivity = value(activeActivities[0], "activityId");
      }
      render();
    } catch (error) {
      notify(error.message, true);
      content.innerHTML = `<section class="superhost-card"><p>${escapeHtml(error.message)}</p></section>`;
    } finally {
      loading = false;
    }
  }

  async function mutate(action, payload, success = text().saved) {
    try {
      const result = await requestAction(action, payload);
      if (result.temporaryPassword) temporaryPassword = String(result.temporaryPassword);
      notify(result.warning || success);
      await load();
      window.dispatchEvent(new CustomEvent("guest-star:admin-changed"));
      return result;
    } catch (error) {
      notify(error.message, true);
      return null;
    }
  }

  function renderTabs() {
    tabs.innerHTML = Object.entries(text().tabs).map(([key, label]) =>
      `<button type="button" class="${key === activeTab ? "active" : ""}" data-superhost-tab="${key}">${escapeHtml(label)}</button>`
    ).join("");
    workspace.querySelectorAll("[data-superhost-language]").forEach((button) => {
      button.classList.toggle("active", button.dataset.superhostLanguage === language);
    });
    document.querySelector("#superhostTitle").textContent = text().title;
    document.querySelector("#superhostSubtitle").textContent = text().subtitle;
  }

  function hotelCard(hotel, deleted) {
    const id = value(hotel, "hotelId");
    return `<article class="superhost-entity hotel-entity" data-hotel-card="${escapeHtml(id)}">
      <img class="hotel-qr-preview" data-qr-url="${escapeHtml(value(hotel, "publicUrl"))}" alt="QR ${escapeHtml(value(hotel, "name"))}" />
      <div><strong>${escapeHtml(value(hotel, "name"))}</strong><small>${escapeHtml(value(hotel, "timezone"))} · ${escapeHtml(value(hotel, "status"))}</small><code>${escapeHtml(value(hotel, "publicUrl"))}</code></div>
      <div class="superhost-actions">
        ${deleted ? "" : `<button data-action="open-link" data-id="${escapeHtml(id)}">${escapeHtml(text().publicPage)}</button><button data-action="copy-link" data-id="${escapeHtml(id)}">${escapeHtml(text().copyLink)}</button><button data-action="show-qr" data-id="${escapeHtml(id)}">${escapeHtml(text().showQr)}</button>`}
        <button class="${deleted ? "" : "danger"}" data-action="${deleted ? "restore-hotel" : "delete-hotel"}" data-id="${escapeHtml(id)}">${escapeHtml(deleted ? text().restoreHotel : text().deleteHotel)}</button>
      </div>
    </article>`;
  }

  function renderHotels() {
    const hotels = admin.hotels || [];
    const active = hotels.filter((hotel) => value(hotel, "status") === "active");
    const deleted = hotels.filter((hotel) => value(hotel, "status") !== "active");
    content.innerHTML = `<div class="superhost-grid two">
      <section class="superhost-card"><h3>${escapeHtml(text().createHotel)}</h3><form id="createHotelForm" class="superhost-form"><label>${escapeHtml(text().hotelName)}<input name="name" required /></label><label>${escapeHtml(text().timezone)}<input name="timezone" value="America/Santo_Domingo" required /></label><button class="button primary">${escapeHtml(text().createHotel)}</button></form></section>
      <section class="superhost-card"><h3>${escapeHtml(text().activeHotels)}</h3><div class="superhost-list">${active.length ? active.map((hotel) => hotelCard(hotel, false)).join("") : `<p>${escapeHtml(text().noItems)}</p>`}</div></section>
    </div><section class="superhost-card"><h3>${escapeHtml(text().deletedHotels)}</h3><div class="superhost-list">${deleted.length ? deleted.map((hotel) => hotelCard(hotel, true)).join("") : `<p>${escapeHtml(text().noItems)}</p>`}</div></section>`;
    content.querySelectorAll(".hotel-qr-preview").forEach((image) => {
      try { setLocalQrImage(image, image.dataset.qrUrl, 240); } catch { image.remove(); }
    });
  }

  function renderOperation() {
    const hotels = (admin.hotels || []).filter((hotel) => value(hotel, "status") === "active");
    const venues = (admin.venues || []).filter((venue) => value(venue, "status") === "active");
    const activities = (admin.activities || []).filter((activity) => value(activity, "status") !== "inactive");
    const hotelNames = new Map(hotels.map((hotel) => [value(hotel, "hotelId"), value(hotel, "name")]));
    const venueNames = new Map(venues.map((venue) => [value(venue, "venueId"), value(venue, "name")]));
    content.innerHTML = `<div class="superhost-grid three">
      <section class="superhost-card"><h3>${escapeHtml(text().createVenue)}</h3><form id="createVenueForm" class="superhost-form"><label>${escapeHtml(text().hotel)}<select name="hotelId" required>${options(hotels, "hotelId", (item) => value(item, "name"))}</select></label><label>${escapeHtml(text().venueName)}<input name="name" required /></label><button class="button primary">${escapeHtml(text().createVenue)}</button></form></section>
      <section class="superhost-card"><h3>${escapeHtml(text().createActivity)}</h3><form id="createActivityForm" class="superhost-form"><label>${escapeHtml(text().venues)}<select name="venueId" required>${options(venues, "venueId", (item) => `${hotelNames.get(value(item, "hotelId")) || "Hotel"} — ${value(item, "name")}`)}</select></label><label>${escapeHtml(text().activityName)}<input name="name" required /></label><label>${escapeHtml(text().duration)}<input name="durationMinutes" type="number" min="15" value="120" /></label><label>${escapeHtml(text().transition)}<input name="transitionSeconds" type="number" min="0" max="900" value="30" /></label><button class="button primary">${escapeHtml(text().createActivity)}</button></form></section>
      <section class="superhost-card"><h3>${escapeHtml(text().schedule)}</h3><form id="scheduleForm" class="superhost-form"><label>${escapeHtml(text().activities)}<select name="activityId" required>${options(activities, "activityId", (item) => `${hotelNames.get(value(item, "hotelId")) || "Hotel"} — ${venueNames.get(value(item, "venueId")) || "Venue"} — ${value(item, "name")}`)}</select></label><label>${escapeHtml(text().scheduledStart)}<input name="scheduledLocal" type="datetime-local" required /></label><label>${escapeHtml(text().duration)}<input name="durationMinutes" type="number" min="15" value="120" /></label><label>${escapeHtml(text().openingLead)}<input name="openingLeadMinutes" type="number" min="0" value="60" /></label><label>${escapeHtml(text().recurrence)}<select name="recurrenceType"><option value="none">${escapeHtml(text().none)}</option><option value="daily">${escapeHtml(text().daily)}</option><option value="weekly">${escapeHtml(text().weekly)}</option><option value="monthly">${escapeHtml(text().monthly)}</option></select></label><label class="check-row"><input name="autoOpenRequests" type="checkbox" />${escapeHtml(text().autoOpen)}</label><label class="check-row"><input name="autoStartActivity" type="checkbox" />${escapeHtml(text().autoStart)}</label><label class="check-row"><input name="showCountdown" type="checkbox" checked />${escapeHtml(text().countdown)}</label><button class="button primary">${escapeHtml(text().saveSchedule)}</button></form></section>
    </div>
    <div class="superhost-grid two"><section class="superhost-card"><h3>${escapeHtml(text().venues)}</h3><div class="superhost-list">${venues.map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(value(item, "name"))}</strong><small>${escapeHtml(hotelNames.get(value(item, "hotelId")) || "")}</small></div></article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div><h3>${escapeHtml(text().activities)}</h3><div class="superhost-list">${activities.map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(value(item, "name"))}</strong><small>${escapeHtml(hotelNames.get(value(item, "hotelId")) || "")} · ${escapeHtml(venueNames.get(value(item, "venueId")) || "")}</small></div></article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section>
      <section class="superhost-card"><h3>${escapeHtml(text().schedules)}</h3><div class="superhost-list">${(admin.schedules || []).map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(new Date(value(item, "scheduledStartAt")).toLocaleString(language === "es" ? "es-DO" : "en-US"))}</strong><small>${escapeHtml(value(item, "recurrenceType"))} · ${escapeHtml(value(item, "status"))}</small></div>${value(item, "status") === "active" ? `<button data-action="cancel-schedule" data-id="${escapeHtml(value(item, "scheduleId"))}" data-hotel="${escapeHtml(value(item, "hotelId"))}" data-venue="${escapeHtml(value(item, "venueId"))}" data-activity="${escapeHtml(value(item, "activityId"))}">${escapeHtml(text().cancel)}</button>` : ""}</article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div><h3>${escapeHtml(text().reviews)}</h3><label>${escapeHtml(text().activities)}<select id="reviewActivity">${options(activities, "activityId", (item) => value(item, "name"), selectedReviewActivity)}</select></label><button class="button ghost" data-action="load-reviews">${escapeHtml(text().loadReviews)}</button><div class="superhost-list">${reviews.map((review) => `<article class="superhost-entity"><div><strong>${"★".repeat(Math.max(0, Number(review.rating) || 0))} ${escapeHtml(value(review, "guestName") || (language === "es" ? "Huésped" : "Guest"))}</strong><p>${escapeHtml(value(review, "comment"))}</p></div><div><button data-action="archive-review" data-id="${escapeHtml(value(review, "reviewId"))}">${escapeHtml(text().archive)}</button><button class="danger" data-action="delete-review" data-id="${escapeHtml(value(review, "reviewId"))}">${escapeHtml(text().delete)}</button></div></article>`).join("")}</div></section></div>`;
  }

  function renderUsers() {
    const hotels = (admin.hotels || []).filter((hotel) => value(hotel, "status") === "active");
    const users = (admin.users || []).filter((user) => value(user, "role") !== "superhost");
    const assignments = admin.assignments || [];
    const hotelNames = new Map((admin.hotels || []).map((hotel) => [value(hotel, "hotelId"), value(hotel, "name")]));
    const userNames = new Map(users.map((user) => [value(user, "userId"), value(user, "displayName")]));
    content.innerHTML = `<div class="superhost-grid two"><section class="superhost-card"><h3>${escapeHtml(text().createHost)}</h3><form id="createHostForm" class="superhost-form"><label>${escapeHtml(text().displayName)}<input name="displayName" required /></label><label>${escapeHtml(text().username)}<input name="username" required /></label><label>${escapeHtml(text().email)}<input name="email" type="email" /></label><button class="button primary">${escapeHtml(text().createHost)}</button></form>${temporaryPassword ? `<div class="temporary-password"><strong>${escapeHtml(text().temporaryPassword)}</strong><code>${escapeHtml(temporaryPassword)}</code><button data-action="copy-password">${escapeHtml(text().copy)}</button></div>` : ""}<h3>${escapeHtml(text().hosts)}</h3><div class="superhost-list">${users.map((user) => { const inactive = value(user, "status") === "inactive"; return `<article class="superhost-entity"><div><strong>${escapeHtml(value(user, "displayName"))}</strong><small>${escapeHtml(value(user, "username"))} · ${escapeHtml(value(user, "status"))}</small></div><button data-action="toggle-host" data-id="${escapeHtml(value(user, "userId"))}" data-status="${inactive ? "active" : "inactive"}">${escapeHtml(inactive ? text().activate : text().deactivate)}</button></article>`; }).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section>
      <section class="superhost-card"><h3>${escapeHtml(text().assignments)}</h3><form id="assignmentForm" class="superhost-form"><label>${escapeHtml(text().user)}<select name="userId" required>${options(users.filter((user) => value(user, "status") !== "inactive"), "userId", (item) => `${value(item, "displayName")} (${value(item, "username")})`)}</select></label><label>${escapeHtml(text().hotel)}<select name="hotelId" required>${options(hotels, "hotelId", (item) => value(item, "name"))}</select></label><label>${escapeHtml(text().preset)}<select name="preset"><option value="operator">${escapeHtml(text().operator)}</option><option value="manager">${escapeHtml(text().manager)}</option><option value="viewer">${escapeHtml(text().viewer)}</option></select></label><button class="button primary">${escapeHtml(text().assign)}</button></form><div class="superhost-list">${assignments.filter((item) => value(item, "status") === "active").map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(userNames.get(value(item, "userId")) || "Host")}</strong><small>${escapeHtml(hotelNames.get(value(item, "hotelId")) || "Hotel")}</small></div><button data-action="revoke-assignment" data-id="${escapeHtml(value(item, "assignmentId"))}">${escapeHtml(text().revoke)}</button></article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section></div>`;
  }

  function renderBranding() {
    const hotels = (admin.hotels || []).filter((hotel) => value(hotel, "status") === "active");
    if (!hotels.some((hotel) => value(hotel, "hotelId") === selectedBrandingHotel)) {
      selectedBrandingHotel = value(hotels[0], "hotelId");
    }
    const branding = (admin.branding || []).find((item) => value(item, "hotelId") === selectedBrandingHotel) || {};
    const checkboxes = [
      "showHotelName", "showHotelLogo", "showTeamIdentity", "showActivityDetails",
      "showCountdown", "showNextActivity", "showAddToCalendar", "showInternalRating",
      "showExternalReview", "showRemindMe", "offerFollowUp"
    ];
    content.innerHTML = `<section class="superhost-card"><h3>${escapeHtml(text().branding)}</h3><label>${escapeHtml(text().hotel)}<select id="brandingHotel">${options(hotels, "hotelId", (item) => value(item, "name"), selectedBrandingHotel)}</select></label><form id="brandingForm" class="superhost-form wide"><div class="superhost-grid two"><label>${escapeHtml(text().teamName)}<input name="teamDisplayName" value="${escapeHtml(value(branding, "teamDisplayName"))}" /></label><label>${escapeHtml(text().teamType)}<input name="teamType" value="${escapeHtml(value(branding, "teamType"))}" /></label></div><label>${escapeHtml(text().tagline)}<input name="tagline" value="${escapeHtml(value(branding, "tagline"))}" /></label><div class="superhost-grid two"><label>${escapeHtml(text().hotelLogo)}<input name="hotelLogoUrl" type="url" value="${escapeHtml(value(branding, "hotelLogoUrl"))}" /></label><label>${escapeHtml(text().teamLogo)}<input name="teamLogoUrl" type="url" value="${escapeHtml(value(branding, "teamLogoUrl"))}" /></label></div><div class="superhost-grid three"><label>${escapeHtml(text().primaryColor)}<input name="primaryColor" type="color" value="${escapeHtml(value(branding, "primaryColor") || "#ff2d95")}" /></label><label>${escapeHtml(text().secondaryColor)}<input name="secondaryColor" type="color" value="${escapeHtml(value(branding, "secondaryColor") || "#8b3dff")}" /></label><label>${escapeHtml(text().accentColor)}<input name="accentColor" type="color" value="${escapeHtml(value(branding, "accentColor") || "#00c8ff")}" /></label></div><label>${escapeHtml(text().welcome)}<input name="welcomeMessage" value="${escapeHtml(value(branding, "welcomeMessage"))}" /></label><label>${escapeHtml(text().liveTitle)}<input name="inProgressTitle" value="${escapeHtml(value(branding, "inProgressTitle"))}" /></label><label>${escapeHtml(text().liveMessage)}<input name="inProgressMessage" value="${escapeHtml(value(branding, "inProgressMessage"))}" /></label><label>${escapeHtml(text().finishedMessage)}<input name="activityFinishedMessage" value="${escapeHtml(value(branding, "activityFinishedMessage"))}" /></label><label>${escapeHtml(text().upcomingMessage)}<input name="upcomingActivityMessage" value="${escapeHtml(value(branding, "upcomingActivityMessage"))}" /></label><label>${escapeHtml(text().reviewInvitation)}<input name="reviewInvitationMessage" value="${escapeHtml(value(branding, "reviewInvitationMessage"))}" /></label><div class="superhost-grid two"><label>${escapeHtml(text().externalProvider)}<input name="externalReviewProvider" value="${escapeHtml(value(branding, "externalReviewProvider"))}" /></label><label>${escapeHtml(text().externalUrl)}<input name="externalReviewUrl" type="url" value="${escapeHtml(value(branding, "externalReviewUrl"))}" /></label></div><div class="checkbox-grid">${checkboxes.map((name) => `<label class="check-row"><input name="${name}" type="checkbox"${checked(branding[name]) ? " checked" : ""} />${escapeHtml(text()[name])}</label>`).join("")}</div><button class="button primary">${escapeHtml(text().saveBranding)}</button></form></section>`;
  }

  function renderFavorites() {
    const hotels = (admin.hotels || []).filter((hotel) => value(hotel, "status") === "active");
    if (!hotels.some((hotel) => value(hotel, "hotelId") === selectedFavoriteHotel)) {
      selectedFavoriteHotel = value(hotels[0], "hotelId");
    }
    const favorites = admin.localFavoritesByHotel?.[selectedFavoriteHotel] || [];
    content.innerHTML = `<div class="superhost-grid two"><section class="superhost-card"><h3>${escapeHtml(text().addFavorite)}</h3><label>${escapeHtml(text().hotel)}<select id="favoriteHotel">${options(hotels, "hotelId", (item) => value(item, "name"), selectedFavoriteHotel)}</select></label><form id="favoriteForm" class="superhost-form"><label>${escapeHtml(text().song)}<input name="song" required /></label><label>${escapeHtml(text().artist)}<input name="artist" required /></label><label>${escapeHtml(text().language)}<select name="language"><option value="Español">Español</option><option value="English">English</option></select></label><button class="button primary">${escapeHtml(text().addFavorite)}</button></form></section><section class="superhost-card"><h3>${escapeHtml(text().favoriteList)}</h3><div class="superhost-list">${favorites.map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(item.song)}</strong><small>${escapeHtml(item.artist)} · ${escapeHtml(item.language)}</small></div><div><button data-action="edit-favorite" data-id="${escapeHtml(item.favoriteId)}">${escapeHtml(text().edit)}</button><button class="danger" data-action="delete-favorite" data-id="${escapeHtml(item.favoriteId)}">${escapeHtml(text().delete)}</button></div></article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section></div>`;
  }

  function renderDevices() {
    const users = new Map((admin.users || []).map((user) => [value(user, "userId"), value(user, "displayName")]));
    content.innerHTML = `<div class="superhost-grid two"><section class="superhost-card"><h3>${escapeHtml(text().devices)}</h3><div class="superhost-list">${(admin.devices || []).map((device) => `<article class="superhost-entity"><div><strong>${escapeHtml(value(device, "deviceName"))}</strong><small>${escapeHtml(users.get(value(device, "userId")) || "")} · ${escapeHtml(value(device, "status"))} · Bridge ${escapeHtml(value(device, "bridgeVersion"))} · VDJ ${checked(device.virtualDJConnected) ? "online" : "offline"}</small><small>${escapeHtml(text().lastHeartbeat)}: ${escapeHtml(value(device, "lastHeartbeatAt") || "—")}</small></div>${value(device, "status") === "active" ? `<button data-action="revoke-device" data-id="${escapeHtml(value(device, "deviceId"))}">${escapeHtml(text().revoke)}</button>` : ""}</article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section><section class="superhost-card"><h3>${escapeHtml(text().audit)}</h3><div class="audit-list">${[...(admin.auditLog || [])].slice(-100).reverse().map((entry) => `<div><strong>${escapeHtml(value(entry, "action"))}</strong><span>${escapeHtml(value(entry, "createdAt"))}</span></div>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section></div>`;
  }

  function render() {
    if (!admin) return;
    renderTabs();
    if (activeTab === "hotels") renderHotels();
    else if (activeTab === "operation") renderOperation();
    else if (activeTab === "users") renderUsers();
    else if (activeTab === "branding") renderBranding();
    else if (activeTab === "favorites") renderFavorites();
    else renderDevices();
  }

  function formPayload(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  content.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = formPayload(form);
    if (form.id === "createHotelForm") {
      if (await mutate("createHotel", data)) form.reset();
    } else if (form.id === "createVenueForm") {
      if (await mutate("createVenue", data)) form.reset();
    } else if (form.id === "createActivityForm") {
      const venue = (admin.venues || []).find((item) => value(item, "venueId") === data.venueId);
      await mutate("createActivity", {
        hotelId: value(venue, "hotelId"),
        venueId: data.venueId,
        name: data.name,
        defaultDurationSeconds: Number(data.durationMinutes) * 60,
        defaultTransitionSeconds: Number(data.transitionSeconds),
        showCountdown: true
      });
    } else if (form.id === "scheduleForm") {
      const activity = (admin.activities || []).find((item) => value(item, "activityId") === data.activityId);
      await mutate("scheduleActivity", {
        hotelId: value(activity, "hotelId"),
        venueId: value(activity, "venueId"),
        activityId: data.activityId,
        scheduledLocal: data.scheduledLocal,
        durationSeconds: Number(data.durationMinutes) * 60,
        requestOpeningLeadSeconds: Number(data.openingLeadMinutes) * 60,
        autoOpenRequests: data.autoOpenRequests === "on",
        autoStartActivity: data.autoStartActivity === "on",
        showCountdown: data.showCountdown === "on",
        recurrenceType: data.recurrenceType,
        recurrenceInterval: 1
      });
    } else if (form.id === "createHostForm") {
      if (await mutate("createHost", data)) form.reset();
    } else if (form.id === "assignmentForm") {
      await mutate("assignUser", {
        userId: data.userId,
        hotelId: data.hotelId,
        permissions: permissionPreset(data.preset)
      });
    } else if (form.id === "brandingForm") {
      const branding = { ...data };
      form.querySelectorAll("input[type=checkbox]").forEach((input) => {
        branding[input.name] = input.checked;
      });
      await mutate("updateHotelBranding", {
        hotelId: selectedBrandingHotel,
        branding
      });
    } else if (form.id === "favoriteForm") {
      try {
        await api("/api/favorites", {
          method: "POST",
          body: JSON.stringify({ operation: "add", hotelId: selectedFavoriteHotel, ...data })
        });
        notify(text().saved);
        form.reset();
        await load();
      } catch (error) { notify(error.message, true); }
    }
  });

  content.addEventListener("change", (event) => {
    if (event.target.id === "brandingHotel") {
      selectedBrandingHotel = event.target.value;
      renderBranding();
    } else if (event.target.id === "favoriteHotel") {
      selectedFavoriteHotel = event.target.value;
      renderFavorites();
    } else if (event.target.id === "reviewActivity") {
      selectedReviewActivity = event.target.value;
      reviews = [];
    }
  });

  content.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    const hotel = (admin.hotels || []).find((item) => value(item, "hotelId") === id);
    if (action === "open-link") openExternal(value(hotel, "publicUrl"));
    else if (action === "copy-link") copyLink(value(hotel, "publicUrl"), text().saved);
    else if (action === "show-qr") {
      window.dispatchEvent(new CustomEvent("guest-star:show-qr", {
        detail: { url: value(hotel, "publicUrl"), name: value(hotel, "name") }
      }));
    } else if (action === "delete-hotel") {
      const typed = window.prompt(`${text().deletePrompt}\n${value(hotel, "name")}`, "");
      if (typed !== value(hotel, "name")) {
        notify(text().deleteMismatch, true);
        return;
      }
      await mutate("updateHotel", {
        hotelId: id,
        status: "inactive",
        confirmHotelName: typed
      });
    } else if (action === "restore-hotel") {
      await mutate("updateHotel", { hotelId: id, status: "active" });
    } else if (action === "toggle-host") {
      if (button.dataset.status === "inactive" && !window.confirm(text().confirmDeactivate)) return;
      await mutate("updateHost", { userId: id, status: button.dataset.status });
    } else if (action === "revoke-assignment") {
      if (window.confirm(text().confirmRevoke)) await mutate("revokeAssignment", { assignmentId: id });
    } else if (action === "revoke-device") {
      if (window.confirm(text().confirmRevoke)) await mutate("revokeDevice", { deviceId: id });
    } else if (action === "copy-password") {
      copyLink(temporaryPassword, text().saved);
    } else if (action === "cancel-schedule") {
      await mutate("cancelSchedule", {
        scheduleId: id,
        hotelId: button.dataset.hotel,
        venueId: button.dataset.venue,
        activityId: button.dataset.activity
      });
    } else if (action === "load-reviews") {
      const activityId = selectedReviewActivity || content.querySelector("#reviewActivity")?.value;
      const activity = (admin.activities || []).find((item) => value(item, "activityId") === activityId);
      try {
        const result = await requestAction("listReviews", {
          hotelId: value(activity, "hotelId"),
          venueId: value(activity, "venueId"),
          activityId
        });
        reviews = result.reviews || [];
        renderOperation();
      } catch (error) { notify(error.message, true); }
    } else if (action === "archive-review" || action === "delete-review") {
      if (action === "delete-review" && !window.confirm(text().confirmDeleteReview)) return;
      const activityId = selectedReviewActivity || content.querySelector("#reviewActivity")?.value;
      const activity = (admin.activities || []).find((item) => value(item, "activityId") === activityId);
      await mutate("updateReview", {
        hotelId: value(activity, "hotelId"),
        venueId: value(activity, "venueId"),
        activityId,
        reviewId: id,
        operation: action === "delete-review" ? "delete" : "archive"
      });
    } else if (action === "delete-favorite" || action === "edit-favorite") {
      const favorite = (admin.localFavoritesByHotel?.[selectedFavoriteHotel] || [])
        .find((item) => item.favoriteId === id);
      if (!favorite) return;
      let payload = { operation: "delete", favoriteId: id, hotelId: selectedFavoriteHotel };
      if (action === "edit-favorite") {
        const song = window.prompt(text().song, favorite.song);
        if (song === null) return;
        const artist = window.prompt(text().artist, favorite.artist);
        if (artist === null) return;
        const languageAnswer = window.prompt(
          `${text().language} (Español / English)`,
          favorite.language
        );
        if (languageAnswer === null) return;
        const favoriteLanguage = /^english$/i.test(languageAnswer.trim())
          ? "English"
          : "Español";
        payload = { operation: "update", favoriteId: id, hotelId: selectedFavoriteHotel, song, artist, language: favoriteLanguage };
      }
      try {
        await api("/api/favorites", { method: "POST", body: JSON.stringify(payload) });
        notify(text().saved);
        await load();
      } catch (error) { notify(error.message, true); }
    }
  });

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-superhost-tab]");
    if (!button) return;
    activeTab = button.dataset.superhostTab;
    reviews = [];
    render();
  });

  workspace.querySelectorAll("[data-superhost-language]").forEach((button) => {
    button.addEventListener("click", async () => {
      language = button.dataset.superhostLanguage === "en" ? "en" : "es";
      render();
      try {
        await api("/api/superhost/preferences", {
          method: "POST",
          body: JSON.stringify({ language })
        });
      } catch (error) { notify(error.message, true); }
    });
  });

  function open() {
    if (!opened) {
      opened = true;
      main.classList.add("superhost-mode");
      workspace.classList.remove("hidden");
      void load();
    }
  }

  function close() {
    opened = false;
    main.classList.remove("superhost-mode");
    workspace.classList.add("hidden");
  }

  function sync(state) {
    const superhost = state?.account?.authenticated === true &&
      state?.account?.user?.role === "superhost";
    language = state?.config?.superhostLanguage === "en" ? "en" : "es";
    if (!superhost) {
      autoOpened = false;
      close();
      return;
    }
    if (!autoOpened) {
      autoOpened = true;
      open();
    }
  }

  return { open, close, sync, isOpen: () => opened, reload: load };
}
