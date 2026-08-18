import { setLocalQrImage } from "./qr-ui.js";

const GUEST_LANGUAGES = [
  ["es", "Español"], ["en", "English"], ["fr", "Français"],
  ["it", "Italiano"], ["de", "Deutsch"], ["ru", "Русский"], ["pt", "Português"]
];
const WEEKDAYS = [
  [0, "Domingo", "Sunday"], [1, "Lunes", "Monday"],
  [2, "Martes", "Tuesday"], [3, "Miércoles", "Wednesday"],
  [4, "Jueves", "Thursday"], [5, "Viernes", "Friday"],
  [6, "Sábado", "Saturday"]
];
const BRANDING_MESSAGES = [
  ["welcomeMessage", "welcome"], ["activityEndingMessage", "activityEndingMessage"],
  ["upcomingActivityMessage", "upcomingMessage"], ["reviewInvitationMessage", "reviewInvitation"],
  ["generalReviewMessage", "generalReviewMessage"], ["beforeStartClosedTitle", "beforeStartClosedTitle"],
  ["beforeStartClosedMessage", "beforeStartClosedMessage"], ["beforeStartOpenTitle", "beforeStartOpenTitle"],
  ["beforeStartOpenMessage", "beforeStartOpenMessage"], ["inProgressTitle", "liveTitle"],
  ["inProgressMessage", "liveMessage"], ["requestsClosedTitle", "requestsClosedTitle"],
  ["requestsClosedMessage", "requestsClosedMessage"], ["activityFinishedTitle", "activityFinishedTitle"],
  ["activityFinishedMessage", "finishedMessage"], ["noActivityTitle", "noActivityTitle"],
  ["noActivityMessage", "noActivityMessage"]
];

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
    activityLanguages: "Idiomas permitidos en esta actividad",
    saveLanguages: "Guardar idiomas",
    atLeastOneLanguage: "Selecciona al menos un idioma.",
    venues: "Lugares",
    activities: "Actividades",
    schedule: "Programar actividad",
    scheduledStart: "Fecha y hora",
    openingLead: "Abrir solicitudes minutos antes",
    recurrence: "Repetición",
    none: "No repetir",
    daily: "Diaria",
    weekly: "Semanal",
    biweekly: "Quincenal",
    monthly: "Mensual",
    weekdayHelp: "Días de la semana (para semanal o quincenal)",
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
    createHost: "Crear usuario",
    role: "Rol",
    hostRole: "Host",
    superhostRole: "Superhost",
    displayName: "Nombre visible",
    username: "Usuario",
    email: "Correo opcional",
    password: "Contraseña permanente (mínimo 12 caracteres)",
    confirmPassword: "Confirmar contraseña",
    passwordsMismatch: "Las contraseñas no coinciden.",
    saveHost: "Guardar usuario",
    setPassword: "Establecer nueva contraseña permanente",
    passwordUpdated: "Último cambio de contraseña",
    lastLogin: "Último acceso",
    accountStatus: "Estado",
    showWhileTyping: "Mostrar mientras escribo",
    passwordControlHelp: "Las contraseñas no se pueden leer. El Superhost puede establecer una nueva y todas las sesiones anteriores se cerrarán.",
    hosts: "Usuarios y Superhosts",
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
    activityEndingMessage: "Mensaje de actividad por finalizar",
    generalReviewMessage: "Mensaje general de reseña",
    beforeStartClosedTitle: "Título antes de iniciar (cerrado)",
    beforeStartClosedMessage: "Mensaje antes de iniciar (cerrado)",
    beforeStartOpenTitle: "Título antes de iniciar (abierto)",
    beforeStartOpenMessage: "Mensaje antes de iniciar (abierto)",
    requestsClosedTitle: "Título de solicitudes cerradas",
    requestsClosedMessage: "Mensaje de solicitudes cerradas",
    activityFinishedTitle: "Título de actividad finalizada",
    noActivityTitle: "Título sin actividad",
    noActivityMessage: "Mensaje sin actividad",
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
    originalLanguage: "Idioma original de los mensajes",
    translationMode: "Traducción",
    automaticFree: "Automática · solo cuota gratuita",
    manualByLanguage: "Manual por idioma",
    manualTranslations: "Traducciones manuales por idioma",
    translationHelp: "No se habilitarán cargos. Si la cuota gratuita falla, conserva las traducciones y permite editarlas aquí.",
    translationStatus: "Estado de traducción",
    identityOptions: "Identidad, logos y colores",
    sourceMessages: "Mensajes originales",
    publicOptions: "Reseñas y opciones públicas",
    createCompact: "Crear",
    editActivity: "Editar actividad",
    saveActivity: "Guardar actividad",
    deleteActivity: "Eliminar actividad",
    restoreActivity: "Restaurar actividad",
    deletedActivities: "Actividades eliminadas",
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
    confirmDeactivate: "¿Desactivar este usuario y revocar sus sesiones?",
    confirmRevoke: "¿Revocar este acceso?",
    confirmDeleteReview: "¿Eliminar esta reseña? La acción quedará auditada.",
    confirmDeleteActivity: "¿Eliminar esta actividad? Se cancelará su agenda y podrá restaurarse después."
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
    activityLanguages: "Languages allowed for this activity",
    saveLanguages: "Save languages",
    atLeastOneLanguage: "Select at least one language.",
    venues: "Venues",
    activities: "Activities",
    schedule: "Schedule activity",
    scheduledStart: "Date and time",
    openingLead: "Open requests minutes early",
    recurrence: "Repeat",
    none: "Do not repeat",
    daily: "Daily",
    weekly: "Weekly",
    biweekly: "Every two weeks",
    monthly: "Monthly",
    weekdayHelp: "Days of the week (for weekly or biweekly)",
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
    createHost: "Create user",
    role: "Role",
    hostRole: "Host",
    superhostRole: "Superhost",
    displayName: "Display name",
    username: "Username",
    email: "Optional email",
    password: "Permanent password (12 characters minimum)",
    confirmPassword: "Confirm password",
    passwordsMismatch: "The passwords do not match.",
    saveHost: "Save user",
    setPassword: "Set a new permanent password",
    passwordUpdated: "Last password change",
    lastLogin: "Last sign-in",
    accountStatus: "Status",
    showWhileTyping: "Show while typing",
    passwordControlHelp: "Passwords cannot be read. The Superhost can set a new one and all previous sessions will be signed out.",
    hosts: "Users and Superhosts",
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
    activityEndingMessage: "Activity ending message",
    generalReviewMessage: "General review message",
    beforeStartClosedTitle: "Before-start closed title",
    beforeStartClosedMessage: "Before-start closed message",
    beforeStartOpenTitle: "Before-start open title",
    beforeStartOpenMessage: "Before-start open message",
    requestsClosedTitle: "Requests-closed title",
    requestsClosedMessage: "Requests-closed message",
    activityFinishedTitle: "Finished activity title",
    noActivityTitle: "No-activity title",
    noActivityMessage: "No-activity message",
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
    originalLanguage: "Original message language",
    translationMode: "Translation",
    automaticFree: "Automatic · free quota only",
    manualByLanguage: "Manual by language",
    manualTranslations: "Manual translations by language",
    translationHelp: "No charges are enabled. If the free quota fails, existing translations remain editable here.",
    translationStatus: "Translation status",
    identityOptions: "Identity, logos and colors",
    sourceMessages: "Original messages",
    publicOptions: "Reviews and public options",
    createCompact: "Create",
    editActivity: "Edit activity",
    saveActivity: "Save activity",
    deleteActivity: "Delete activity",
    restoreActivity: "Restore activity",
    deletedActivities: "Deleted activities",
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
    confirmDeactivate: "Deactivate this user and revoke their sessions?",
    confirmRevoke: "Revoke this access?",
    confirmDeleteReview: "Delete this review? The action will be audited.",
    confirmDeleteActivity: "Delete this activity? Its schedule will be cancelled and the activity can be restored later."
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

function activityLanguages(activity) {
  if (Array.isArray(activity?.allowedLanguages)) return activity.allowedLanguages;
  try {
    const parsed = JSON.parse(value(activity, "allowedLanguagesJson") || "[]");
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // Older activities have no language field and default to the full catalog.
  }
  return GUEST_LANGUAGES.map(([code]) => code);
}

function languageCheckboxes(selected = GUEST_LANGUAGES.map(([code]) => code)) {
  return GUEST_LANGUAGES.map(([code, label]) =>
    `<label class="check-row"><input name="language_${code}" type="checkbox"${selected.includes(code) ? " checked" : ""} />${escapeHtml(label)}</label>`
  ).join("");
}

function selectedFormLanguages(form) {
  return GUEST_LANGUAGES.map(([code]) => form.elements[`language_${code}`]?.checked ? code : "").filter(Boolean);
}

function parsedLocalizedMessages(branding) {
  try {
    const parsed = JSON.parse(value(branding, "localizedMessagesJson") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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
    const deletedActivities = (admin.activities || []).filter((activity) => value(activity, "status") === "inactive");
    const hotelNames = new Map(hotels.map((hotel) => [value(hotel, "hotelId"), value(hotel, "name")]));
    const venueNames = new Map(venues.map((venue) => [value(venue, "venueId"), value(venue, "name")]));
    content.innerHTML = `<div class="superhost-grid three">
      <section class="superhost-card"><h3>${escapeHtml(text().createVenue)}</h3><details><summary>${escapeHtml(text().createCompact)}</summary><form id="createVenueForm" class="superhost-form"><label>${escapeHtml(text().hotel)}<select name="hotelId" required>${options(hotels, "hotelId", (item) => value(item, "name"))}</select></label><label>${escapeHtml(text().venueName)}<input name="name" required /></label><button class="button primary">${escapeHtml(text().createVenue)}</button></form></details></section>
      <section class="superhost-card"><h3>${escapeHtml(text().createActivity)}</h3><details><summary>${escapeHtml(text().createCompact)}</summary><form id="createActivityForm" class="superhost-form"><label>${escapeHtml(text().venues)}<select name="venueId" required>${options(venues, "venueId", (item) => `${hotelNames.get(value(item, "hotelId")) || "Hotel"} — ${value(item, "name")}`)}</select></label><label>${escapeHtml(text().activityName)}<input name="name" required /></label><label>${escapeHtml(text().duration)}<input name="durationMinutes" type="number" min="15" value="120" /></label><label>${escapeHtml(text().transition)}<input name="transitionSeconds" type="number" min="0" max="900" value="30" /></label><fieldset class="language-fieldset"><legend>${escapeHtml(text().activityLanguages)}</legend>${languageCheckboxes()}</fieldset><button class="button primary">${escapeHtml(text().createActivity)}</button></form></details></section>
      <section class="superhost-card"><h3>${escapeHtml(text().schedule)}</h3><details><summary>${escapeHtml(text().saveSchedule)}</summary><form id="scheduleForm" class="superhost-form"><label>${escapeHtml(text().activities)}<select name="activityId" required>${options(activities, "activityId", (item) => `${hotelNames.get(value(item, "hotelId")) || "Hotel"} — ${venueNames.get(value(item, "venueId")) || "Venue"} — ${value(item, "name")}`)}</select></label><label>${escapeHtml(text().scheduledStart)}<input name="scheduledLocal" type="datetime-local" required /></label><label>${escapeHtml(text().duration)}<input name="durationMinutes" type="number" min="15" value="120" /></label><label>${escapeHtml(text().openingLead)}<input name="openingLeadMinutes" type="number" min="0" value="60" /></label><label>${escapeHtml(text().recurrence)}<select name="recurrenceType"><option value="none">${escapeHtml(text().none)}</option><option value="daily">${escapeHtml(text().daily)}</option><option value="weekly">${escapeHtml(text().weekly)}</option><option value="biweekly">${escapeHtml(text().biweekly)}</option><option value="monthly">${escapeHtml(text().monthly)}</option></select></label><fieldset class="language-fieldset"><legend>${escapeHtml(text().weekdayHelp)}</legend>${WEEKDAYS.map(([day, es, en]) => `<label class="check-row"><input name="weekday_${day}" type="checkbox" />${escapeHtml(language === "es" ? es : en)}</label>`).join("")}</fieldset><label class="check-row"><input name="autoOpenRequests" type="checkbox" />${escapeHtml(text().autoOpen)}</label><label class="check-row"><input name="autoStartActivity" type="checkbox" />${escapeHtml(text().autoStart)}</label><label class="check-row"><input name="showCountdown" type="checkbox" checked />${escapeHtml(text().countdown)}</label><button class="button primary">${escapeHtml(text().saveSchedule)}</button></form></details></section>
    </div>
    <div class="superhost-grid two"><section class="superhost-card"><h3>${escapeHtml(text().venues)}</h3><div class="superhost-list">${venues.map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(value(item, "name"))}</strong><small>${escapeHtml(hotelNames.get(value(item, "hotelId")) || "")}</small></div></article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div><h3>${escapeHtml(text().activities)}</h3><div class="superhost-list">${activities.map((item) => { const languages = activityLanguages(item); const activityId = escapeHtml(value(item, "activityId")); const transition = Number(item.defaultTransitionSeconds); return `<article class="activity-manage-card"><div><strong>${escapeHtml(value(item, "name"))}</strong><small>${escapeHtml(hotelNames.get(value(item, "hotelId")) || "")} · ${escapeHtml(venueNames.get(value(item, "venueId")) || "")} · ${languages.length} ${escapeHtml(text().language)}</small></div><details><summary>${escapeHtml(text().editActivity)}</summary><form class="superhost-form" data-activity-edit="${activityId}"><label>${escapeHtml(text().activityName)}<input name="name" value="${escapeHtml(value(item, "name"))}" required /></label><label>${escapeHtml(text().duration)}<input name="durationMinutes" type="number" min="15" value="${Math.max(15, (Number(item.defaultDurationSeconds) || 7200) / 60)}" /></label><label>${escapeHtml(text().transition)}<input name="transitionSeconds" type="number" min="0" max="900" value="${Number.isFinite(transition) ? transition : 30}" /></label><button>${escapeHtml(text().saveActivity)}</button></form><form class="activity-language-form" data-activity-languages="${activityId}" data-hotel="${escapeHtml(value(item, "hotelId"))}" data-venue="${escapeHtml(value(item, "venueId"))}"><span>${escapeHtml(text().activityLanguages)}</span>${languageCheckboxes(languages)}<button>${escapeHtml(text().saveLanguages)}</button></form><button class="button danger" data-action="delete-activity" data-id="${activityId}">${escapeHtml(text().deleteActivity)}</button></details></article>`; }).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div>${deletedActivities.length ? `<details><summary>${escapeHtml(text().deletedActivities)}</summary><div class="superhost-list">${deletedActivities.map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(value(item, "name"))}</strong><small>${escapeHtml(text().deletedActivities)}</small></div><button data-action="restore-activity" data-id="${escapeHtml(value(item, "activityId"))}">${escapeHtml(text().restoreActivity)}</button></article>`).join("")}</div></details>` : ""}</section>
      <section class="superhost-card">
        <h3>${escapeHtml(text().schedules)}</h3>
        <div class="superhost-list">
          ${(admin.schedules || []).map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(new Date(value(item, "scheduledStartAt")).toLocaleString(language === "es" ? "es-DO" : "en-US"))}</strong><small>${escapeHtml(value(item, "recurrenceType"))} · ${escapeHtml(value(item, "status"))}</small></div>${value(item, "status") === "active" ? `<button data-action="cancel-schedule" data-id="${escapeHtml(value(item, "scheduleId"))}" data-hotel="${escapeHtml(value(item, "hotelId"))}" data-venue="${escapeHtml(value(item, "venueId"))}" data-activity="${escapeHtml(value(item, "activityId"))}">${escapeHtml(text().cancel)}</button>` : ""}</article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}
        </div>
        <h3>${escapeHtml(text().reviews)}</h3>
        <label>${escapeHtml(text().activities)}<select id="reviewActivity">${options(activities, "activityId", (item) => value(item, "name"), selectedReviewActivity)}</select></label>
        <button class="button ghost" data-action="load-reviews">${escapeHtml(text().loadReviews)}</button>
        <div class="superhost-list">
          ${reviews.map((review) => `<article class="superhost-entity"><div><strong>${"★".repeat(Math.max(0, Number(review.rating) || 0))} ${escapeHtml(value(review, "guestName") || (language === "es" ? "Huésped" : "Guest"))}</strong><p>${escapeHtml(value(review, "comment"))}</p></div><div><button data-action="archive-review" data-id="${escapeHtml(value(review, "reviewId"))}">${escapeHtml(text().archive)}</button><button class="danger" data-action="delete-review" data-id="${escapeHtml(value(review, "reviewId"))}">${escapeHtml(text().delete)}</button></div></article>`).join("")}
        </div>
      </section>
    </div>`;
  }

  function renderUsers() {
    const hotels = (admin.hotels || []).filter((hotel) => value(hotel, "status") === "active");
    const users = admin.users || [];
    const assignableUsers = users.filter((user) => value(user, "role") === "host" && value(user, "status") !== "inactive");
    const assignments = admin.assignments || [];
    const hotelNames = new Map((admin.hotels || []).map((hotel) => [value(hotel, "hotelId"), value(hotel, "name")]));
    const userNames = new Map(users.map((user) => [value(user, "userId"), value(user, "displayName")]));
    content.innerHTML = `<div class="superhost-grid two"><section class="superhost-card"><h3>${escapeHtml(text().hosts)}</h3><details><summary>${escapeHtml(text().createHost)}</summary><form id="createHostForm" class="superhost-form"><label>${escapeHtml(text().role)}<select name="role"><option value="host">${escapeHtml(text().hostRole)}</option><option value="superhost">${escapeHtml(text().superhostRole)}</option></select></label><label>${escapeHtml(text().displayName)}<input name="displayName" required /></label><label>${escapeHtml(text().username)}<input name="username" autocomplete="off" required /></label><label>${escapeHtml(text().email)}<input name="email" type="email" /></label><label>${escapeHtml(text().password)}<input name="password" type="password" autocomplete="new-password" minlength="12" required /></label><label>${escapeHtml(text().confirmPassword)}<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></label><button class="button primary">${escapeHtml(text().createHost)}</button></form></details><p class="settings-help">${escapeHtml(text().passwordControlHelp)}</p><div class="superhost-list">${users.map((user) => { const inactive = value(user, "status") === "inactive"; const userId = escapeHtml(value(user, "userId")); return `<article class="host-account-card"><div><strong>${escapeHtml(value(user, "displayName"))}</strong><small>${escapeHtml(value(user, "role"))} · ${escapeHtml(value(user, "status") || "—")} · ${escapeHtml(text().lastLogin)}: ${escapeHtml(value(user, "lastLoginAt") || "—")}</small></div><details><summary>${escapeHtml(text().edit)}</summary><form class="host-edit-form" data-host-edit="${userId}"><label>${escapeHtml(text().displayName)}<input name="displayName" value="${escapeHtml(value(user, "displayName"))}" required /></label><label>${escapeHtml(text().username)}<input name="username" value="${escapeHtml(value(user, "username"))}" required /></label><label>${escapeHtml(text().email)}<input name="email" type="email" value="${escapeHtml(value(user, "email"))}" /></label><small>${escapeHtml(text().passwordUpdated)}: ${escapeHtml(value(user, "passwordUpdatedAt") || "—")}</small><div class="superhost-actions"><button>${escapeHtml(text().saveHost)}</button><button type="button" data-action="toggle-host" data-id="${userId}" data-status="${inactive ? "active" : "inactive"}">${escapeHtml(inactive ? text().activate : text().deactivate)}</button></div></form><form class="host-password-form" data-host-password="${userId}"><label>${escapeHtml(text().password)}<input name="password" type="password" autocomplete="new-password" minlength="12" required /></label><label>${escapeHtml(text().confirmPassword)}<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required /></label><button>${escapeHtml(text().setPassword)}</button></form></details></article>`; }).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section>
      <section class="superhost-card"><h3>${escapeHtml(text().assignments)}</h3><details><summary>${escapeHtml(text().assign)}</summary><form id="assignmentForm" class="superhost-form"><label>${escapeHtml(text().user)}<select name="userId" required>${options(assignableUsers, "userId", (item) => `${value(item, "displayName")} (${value(item, "username")})`)}</select></label><label>${escapeHtml(text().hotel)}<select name="hotelId" required>${options(hotels, "hotelId", (item) => value(item, "name"))}</select></label><label>${escapeHtml(text().preset)}<select name="preset"><option value="operator">${escapeHtml(text().operator)}</option><option value="manager">${escapeHtml(text().manager)}</option><option value="viewer">${escapeHtml(text().viewer)}</option></select></label><button class="button primary"${assignableUsers.length ? "" : " disabled"}>${escapeHtml(text().assign)}</button></form></details><div class="superhost-list">${assignments.filter((item) => value(item, "status") === "active").map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(userNames.get(value(item, "userId")) || "Host")}</strong><small>${escapeHtml(hotelNames.get(value(item, "hotelId")) || "Hotel")}</small></div><button data-action="revoke-assignment" data-id="${escapeHtml(value(item, "assignmentId"))}">${escapeHtml(text().revoke)}</button></article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section></div>`;
    content.querySelectorAll("#createHostForm, .host-password-form").forEach((form) => {
      const label = document.createElement("label");
      label.className = "check-row";
      label.innerHTML = `<input type="checkbox" data-show-password />${escapeHtml(text().showWhileTyping)}`;
      form.insertBefore(label, form.querySelector("button"));
    });
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
    const localized = parsedLocalizedMessages(branding);
    const messageFields = BRANDING_MESSAGES.map(([field, label]) =>
      `<label>${escapeHtml(text()[label])}<input name="${field}" maxlength="300" value="${escapeHtml(value(branding, field))}" /></label>`
    ).join("");
    const manualFields = GUEST_LANGUAGES.map(([code, languageLabel]) =>
      `<details><summary>${escapeHtml(languageLabel)}</summary><div class="superhost-form compact-fields">${BRANDING_MESSAGES.map(([field, label]) => `<label>${escapeHtml(text()[label])}<input name="manual_${code}_${field}" maxlength="300" value="${escapeHtml(localized[code]?.[field] || "")}" /></label>`).join("")}</div></details>`
    ).join("");
    content.innerHTML = `<section class="superhost-card"><h3>${escapeHtml(text().branding)}</h3><label>${escapeHtml(text().hotel)}<select id="brandingHotel">${options(hotels, "hotelId", (item) => value(item, "name"), selectedBrandingHotel)}</select></label><form id="brandingForm" class="superhost-form wide">
      <details><summary>${escapeHtml(text().identityOptions)}</summary><div class="superhost-form compact-fields"><div class="superhost-grid two"><label>${escapeHtml(text().teamName)}<input name="teamDisplayName" value="${escapeHtml(value(branding, "teamDisplayName"))}" /></label><label>${escapeHtml(text().teamType)}<input name="teamType" value="${escapeHtml(value(branding, "teamType"))}" /></label></div><label>${escapeHtml(text().tagline)}<input name="tagline" value="${escapeHtml(value(branding, "tagline"))}" /></label><div class="superhost-grid two"><label>${escapeHtml(text().hotelLogo)}<input name="hotelLogoUrl" type="url" value="${escapeHtml(value(branding, "hotelLogoUrl"))}" /></label><label>${escapeHtml(text().teamLogo)}<input name="teamLogoUrl" type="url" value="${escapeHtml(value(branding, "teamLogoUrl"))}" /></label></div><div class="superhost-grid three"><label>${escapeHtml(text().primaryColor)}<input name="primaryColor" type="color" value="${escapeHtml(value(branding, "primaryColor") || "#ff2d95")}" /></label><label>${escapeHtml(text().secondaryColor)}<input name="secondaryColor" type="color" value="${escapeHtml(value(branding, "secondaryColor") || "#8b3dff")}" /></label><label>${escapeHtml(text().accentColor)}<input name="accentColor" type="color" value="${escapeHtml(value(branding, "accentColor") || "#00c8ff")}" /></label></div></div></details>
      <div class="superhost-grid two"><label>${escapeHtml(text().originalLanguage)}<select name="messageSourceLanguage">${GUEST_LANGUAGES.map(([code, label]) => `<option value="${code}"${value(branding, "messageSourceLanguage") === code || (!value(branding, "messageSourceLanguage") && code === "en") ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label><label>${escapeHtml(text().translationMode)}<select name="translationMode"><option value="auto"${value(branding, "translationMode") !== "manual" ? " selected" : ""}>${escapeHtml(text().automaticFree)}</option><option value="manual"${value(branding, "translationMode") === "manual" ? " selected" : ""}>${escapeHtml(text().manualByLanguage)}</option></select></label></div>
      <small>${escapeHtml(text().translationStatus)}: ${escapeHtml(value(branding, "translationStatus") || "—")}. ${escapeHtml(text().translationHelp)}</small>
      <details open><summary>${escapeHtml(text().sourceMessages)}</summary><div class="superhost-form compact-fields">${messageFields}</div></details>
      <details><summary>${escapeHtml(text().manualTranslations)}</summary><p class="settings-help">${escapeHtml(text().translationHelp)}</p>${manualFields}</details>
      <details><summary>${escapeHtml(text().publicOptions)}</summary><div class="superhost-form compact-fields"><div class="superhost-grid two"><label>${escapeHtml(text().externalProvider)}<input name="externalReviewProvider" value="${escapeHtml(value(branding, "externalReviewProvider"))}" /></label><label>${escapeHtml(text().externalUrl)}<input name="externalReviewUrl" type="url" value="${escapeHtml(value(branding, "externalReviewUrl"))}" /></label></div><div class="checkbox-grid">${checkboxes.map((name) => `<label class="check-row"><input name="${name}" type="checkbox"${checked(branding[name]) ? " checked" : ""} />${escapeHtml(text()[name])}</label>`).join("")}</div></div></details>
      <button class="button primary">${escapeHtml(text().saveBranding)}</button></form></section>`;
  }

  function renderFavorites() {
    const hotels = (admin.hotels || []).filter((hotel) => value(hotel, "status") === "active");
    if (!hotels.some((hotel) => value(hotel, "hotelId") === selectedFavoriteHotel)) {
      selectedFavoriteHotel = value(hotels[0], "hotelId");
    }
    const favorites = admin.localFavoritesByHotel?.[selectedFavoriteHotel] || [];
    content.innerHTML = `<div class="superhost-grid two"><section class="superhost-card"><h3>${escapeHtml(text().addFavorite)}</h3><label>${escapeHtml(text().hotel)}<select id="favoriteHotel">${options(hotels, "hotelId", (item) => value(item, "name"), selectedFavoriteHotel)}</select></label><form id="favoriteForm" class="superhost-form"><label>${escapeHtml(text().song)}<input name="song" required /></label><label>${escapeHtml(text().artist)}<input name="artist" required /></label><label>${escapeHtml(text().language)}<select name="language">${GUEST_LANGUAGES.map(([, label]) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join("")}</select></label><button class="button primary">${escapeHtml(text().addFavorite)}</button></form></section><section class="superhost-card"><h3>${escapeHtml(text().favoriteList)}</h3><div class="superhost-list">${favorites.map((item) => `<article class="superhost-entity"><div><strong>${escapeHtml(item.song)}</strong><small>${escapeHtml(item.artist)} · ${escapeHtml(item.language)}</small></div><div><button data-action="edit-favorite" data-id="${escapeHtml(item.favoriteId)}">${escapeHtml(text().edit)}</button><button class="danger" data-action="delete-favorite" data-id="${escapeHtml(item.favoriteId)}">${escapeHtml(text().delete)}</button></div></article>`).join("") || `<p>${escapeHtml(text().noItems)}</p>`}</div></section></div>`;
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
    if (form.dataset.activityLanguages) {
      const allowedLanguages = selectedFormLanguages(form);
      if (!allowedLanguages.length) {
        notify(text().atLeastOneLanguage, true);
        return;
      }
      await mutate("updateActivityLanguages", {
        hotelId: form.dataset.hotel,
        venueId: form.dataset.venue,
        activityId: form.dataset.activityLanguages,
        allowedLanguages
      });
    } else if (form.dataset.activityEdit) {
      await mutate("updateActivity", {
        activityId: form.dataset.activityEdit,
        name: data.name,
        defaultDurationSeconds: Number(data.durationMinutes) * 60,
        defaultTransitionSeconds: Number(data.transitionSeconds)
      });
    } else if (form.dataset.hostEdit) {
      await mutate("updateHost", {
        userId: form.dataset.hostEdit,
        displayName: data.displayName,
        username: data.username,
        email: data.email
      });
    } else if (form.dataset.hostPassword) {
      if (data.password !== data.confirmPassword) {
        notify(text().passwordsMismatch, true);
        return;
      }
      await mutate("setHostPassword", {
        userId: form.dataset.hostPassword,
        password: data.password
      });
    } else if (form.id === "createHotelForm") {
      if (await mutate("createHotel", data)) form.reset();
    } else if (form.id === "createVenueForm") {
      if (await mutate("createVenue", data)) form.reset();
    } else if (form.id === "createActivityForm") {
      const venue = (admin.venues || []).find((item) => value(item, "venueId") === data.venueId);
      const allowedLanguages = selectedFormLanguages(form);
      if (!allowedLanguages.length) {
        notify(text().atLeastOneLanguage, true);
        return;
      }
      await mutate("createActivity", {
        hotelId: value(venue, "hotelId"),
        venueId: data.venueId,
        name: data.name,
        defaultDurationSeconds: Number(data.durationMinutes) * 60,
        defaultTransitionSeconds: Number(data.transitionSeconds),
        showCountdown: true,
        allowedLanguages
      });
    } else if (form.id === "scheduleForm") {
      const activity = (admin.activities || []).find((item) => value(item, "activityId") === data.activityId);
      const recurrenceDays = WEEKDAYS.map(([day]) => data[`weekday_${day}`] === "on" ? day : null)
        .filter((day) => day !== null);
      if (["weekly", "biweekly"].includes(data.recurrenceType) && !recurrenceDays.length) {
        notify(text().weekdayHelp, true);
        return;
      }
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
        recurrenceInterval: data.recurrenceType === "biweekly" ? 2 : 1,
        recurrenceDays
      });
    } else if (form.id === "createHostForm") {
      if (data.password !== data.confirmPassword) {
        notify(text().passwordsMismatch, true);
        return;
      }
      const payload = { ...data };
      delete payload.confirmPassword;
      if (await mutate("createHost", payload)) form.reset();
    } else if (form.id === "assignmentForm") {
      await mutate("assignUser", {
        userId: data.userId,
        hotelId: data.hotelId,
        permissions: permissionPreset(data.preset)
      });
    } else if (form.id === "brandingForm") {
      const branding = { ...data };
      const manualLocalized = Object.fromEntries(GUEST_LANGUAGES.map(([code]) => [
        code,
        Object.fromEntries(BRANDING_MESSAGES.map(([field]) => [
          field,
          String(data[`manual_${code}_${field}`] || "").trim()
        ]).filter(([, message]) => message))
      ]));
      Object.keys(branding).filter((name) => name.startsWith("manual_")).forEach((name) => {
        delete branding[name];
      });
      branding.localizedMessagesJson = manualLocalized;
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
    if (event.target.matches("[data-show-password]")) {
      const type = event.target.checked ? "text" : "password";
      event.target.closest("form")?.querySelectorAll(
        'input[name="password"], input[name="confirmPassword"]'
      ).forEach((input) => { input.type = type; });
    } else if (event.target.id === "brandingHotel") {
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
    } else if (action === "delete-activity") {
      if (!window.confirm(text().confirmDeleteActivity)) return;
      await mutate("updateActivity", { activityId: id, status: "inactive" });
    } else if (action === "restore-activity") {
      await mutate("updateActivity", { activityId: id, status: "ready" });
    } else if (action === "toggle-host") {
      if (button.dataset.status === "inactive" && !window.confirm(text().confirmDeactivate)) return;
      await mutate("updateHost", { userId: id, status: button.dataset.status });
    } else if (action === "revoke-assignment") {
      if (window.confirm(text().confirmRevoke)) await mutate("revokeAssignment", { assignmentId: id });
    } else if (action === "revoke-device") {
      if (window.confirm(text().confirmRevoke)) await mutate("revokeDevice", { deviceId: id });
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
        const languageAnswer = window.prompt(`${text().language} (${GUEST_LANGUAGES.map(([, label]) => label).join(" / ")})`, favorite.language);
        if (languageAnswer === null) return;
        const normalized = languageAnswer.trim().toLocaleLowerCase();
        const match = GUEST_LANGUAGES.find(([code, label]) =>
          code === normalized || label.toLocaleLowerCase() === normalized
        );
        const favoriteLanguage = match?.[1] || favorite.language || "Español";
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

  function openTab(tab = "hotels") {
    activeTab = Object.prototype.hasOwnProperty.call(text().tabs, tab) ? tab : "hotels";
    open();
    if (admin) render();
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

  return { open, openTab, close, sync, isOpen: () => opened, reload: load };
}
