const PHRASES = [
  ["Local library · YouTube · Live VirtualDJ Karaoke queue", "Biblioteca local · YouTube · Cola Karaoke en vivo de VirtualDJ"],
  ["Bridge language", "Idioma del Bridge"], ["Language", "Idioma"],
  ["Switch Activity", "Cambiar actividad"], ["Change Password", "Cambiar contraseña"],
  ["Log Out", "Cerrar sesión"], ["LOCAL BRIDGE", "BRIDGE LOCAL"],
  ["Connection status", "Estado de conexión"], ["Activity time summary", "Resumen de tiempo de la actividad"],
  ["LIBRARY", "BIBLIOTECA"], ["REQUESTS", "SOLICITUDES"], ["ACTIVITY", "ACTIVIDAD"],
  ["Checking…", "Verificando…"], ["Not tested", "No probado"],
  ["ELAPSED TIME", "TIEMPO TRANSCURRIDO"], ["SUNG + IN QUEUE", "CANTADAS + EN COLA"],
  ["TOTAL REQUESTED", "TOTAL SOLICITADO"], ["ACTIVITY COVERAGE", "COBERTURA DE LA ACTIVIDAD"],
  ["From the activity start", "Desde el inicio de la actividad"],
  ["0 confirmed songs", "0 canciones confirmadas"], ["Skipped songs excluded", "Canciones omitidas excluidas"],
  ["Missing 0:00:00", "Faltan 0:00:00"], ["Calculating rotation…", "Calculando rotación…"],
  ["EVENT END TIME", "HORA DE FINALIZACIÓN"],
  ["EMCEE: respect the event end time when organizing the rotation.", "EMCEE: respeta la hora de finalización al organizar la rotación."],
  ["Current VirtualDJ queue", "Cola actual de VirtualDJ"],
  ["Live VirtualDJ Queue", "Cola real de VirtualDJ"],
  ["SELECT AN ACTIVITY", "SELECCIONA UNA ACTIVIDAD"], ["Guest Star Activity", "Actividad Guest Star"],
  ["Sign in and select the hotel, venue and activity for this computer.", "Inicia sesión y selecciona el hotel, lugar y actividad para esta computadora."],
  ["Share", "Compartir"], ["Activity settings", "Configuración de la actividad"],
  ["More actions", "Más acciones"], ["Requests", "Solicitudes"],
  ["Open", "Abiertas"], ["Closed", "Cerradas"], ["Start Activity", "Iniciar actividad"],
  ["Finish Activity", "Finalizar actividad"], ["Start New Activity", "Iniciar nueva actividad"],
  ["↻ Scan Local Library", "↻ Escanear biblioteca local"], ["Synchronize", "Sincronizar"],
  ["ALEATORIO · RANDOM", "ALEATORIO · RANDOM"],
  ["Infinite lists to fill the rotation", "Listas infinitas para llenar la rotación"],
  ["No repeated songs until each round is complete.", "Sin repetir temas hasta completar cada vuelta."],
  ["Favorites", "Favoritos"],
  ["Both lists", "Ambas listas"],
  ["Choose a list to generate the next songs.", "Elige una lista para generar los próximos temas."],
  ["ACTIVITY & LOCAL SETTINGS", "CONFIGURACIÓN LOCAL Y DE ACTIVIDAD"],
  ["Configure this Bridge", "Configurar este Bridge"], ["Close", "Cerrar"],
  ["Karaoke library folders", "Carpetas de la biblioteca Karaoke"],
  ["Choose Folder on Mac", "Elegir carpeta en Mac"], ["Enter Path", "Escribir ruta"],
  ["Remember selected folders on this Mac", "Recordar las carpetas seleccionadas en esta Mac"],
  ["Legacy 3.x connection settings", "Configuración de conexión legacy 3.x"],
  ["Legacy host PIN", "PIN legacy del host"], ["Leave blank to keep it", "Déjalo vacío para conservarlo"],
  ["Remember legacy PIN", "Recordar PIN legacy"], ["Forget saved PIN", "Olvidar PIN guardado"],
  ["Network Control port", "Puerto de Network Control"], ["Network Control password", "Contraseña de Network Control"],
  ["Leave blank if none", "Déjalo vacío si no existe"],
  ["Remove saved VirtualDJ password", "Eliminar contraseña guardada de VirtualDJ"],
  ["Automatically add an exact local match to VirtualDJ", "Agregar automáticamente a VirtualDJ una coincidencia local exacta"],
  ["ACTIVITY SETTINGS", "CONFIGURACIÓN DE LA ACTIVIDAD"],
  ["Timing and public status", "Tiempo y estado público"],
  ["Activity duration (hours)", "Duración de la actividad (horas)"],
  ["Transition per singer (seconds)", "Transición por cantante (segundos)"],
  ["Scheduled start", "Inicio programado"], ["Accept requests before start", "Aceptar solicitudes antes del inicio"],
  ["Show public countdown", "Mostrar cuenta regresiva pública"],
  ["Start automatically at the scheduled time", "Iniciar automáticamente a la hora programada"],
  ["Show activity status publicly", "Mostrar públicamente el estado de la actividad"],
  ["Languages offered to guests for this activity", "Idiomas ofrecidos a los huéspedes en esta actividad"],
  ["Started", "Iniciada"], ["Accumulated", "Acumulado"], ["Scheduled Remaining", "Tiempo programado restante"],
  ["Activity ID", "ID de actividad"], ["State Revision", "Revisión de estado"],
  ["Last Change", "Último cambio"], ["Last Action", "Última acción"], ["Source", "Origen"],
  ["Times recalculate automatically. Skipped songs are excluded; completed songs stay included.", "Los tiempos se recalculan automáticamente. Las canciones omitidas se excluyen y las completadas permanecen incluidas."],
  ["Test Guest Star", "Probar Guest Star"], ["Test VirtualDJ", "Probar VirtualDJ"],
  ["Save Settings", "Guardar configuración"], ["WELCOME TO GUEST STAR BRIDGE ·", "BIENVENIDO A GUEST STAR BRIDGE ·"],
  ["Sign in", "Iniciar sesión"], ["Use the account created for you by the Superhost.", "Usa la cuenta que creó el Superhost para ti."],
  ["Username or email", "Usuario o correo electrónico"], ["Password", "Contraseña"],
  ["Forgot your username or password, or having trouble signing in?", "¿Olvidaste tu usuario o contraseña, o tienes problemas para iniciar sesión?"],
  ["Contact your Superhost.", "Contacta a tu Superhost."],
  ["Keep me signed in on this Mac", "Mantener mi sesión iniciada en esta Mac"], ["Sign In", "Iniciar sesión"],
  ["BRIDGE ASSIGNMENT", "ASIGNACIÓN DEL BRIDGE"], ["Select your activity", "Selecciona tu actividad"],
  ["Hotel", "Hotel"], ["Venue", "Lugar"], ["Activity", "Actividad"],
  ["Remember this selection", "Recordar esta selección"], ["Use This Activity", "Usar esta actividad"],
  ["SECURE YOUR ACCOUNT", "PROTEGE TU CUENTA"], ["Change your password", "Cambiar tu contraseña"],
  ["Enter your current password and choose a new permanent password.", "Escribe tu contraseña actual y elige una nueva contraseña permanente."],
  ["Current password", "Contraseña actual"], ["New password", "Nueva contraseña"],
  ["Confirm new password", "Confirmar nueva contraseña"], ["Change Password", "Cambiar contraseña"],
  ["PERMANENT HOTEL LINK", "ENLACE PERMANENTE DEL HOTEL"], ["Share Guest Star", "Compartir Guest Star"],
  ["Permanent Guest Star QR code", "Código QR permanente de Guest Star"],
  ["Generated securely on this Mac.", "Generado de forma segura en esta Mac."],
  ["Copy Link", "Copiar enlace"], ["Download QR PNG", "Descargar QR PNG"], ["Print QR", "Imprimir QR"],
  ["Archive and Clear Queue", "Archivar y limpiar cola"], ["Activity Administration", "Administración de actividades"],
  ["Guest Page Preview", "Vista previa de la página pública"],
  ["ACTION CONFIRMED", "ACCIÓN CONFIRMADA"], ["Everything is ready", "Todo está listo"], ["Done", "Listo"],
  ["CONFIRM ACTION", "CONFIRMAR ACCIÓN"], ["Confirm?", "¿Confirmar?"], ["Cancel", "Cancelar"], ["Confirm", "Confirmar"],
  ["View options and actions", "Ver opciones y acciones"], ["View Options and Actions", "Ver opciones y acciones"],
  ["Hide Options and Actions", "Ocultar opciones y acciones"],
  ["No active requests.", "No hay solicitudes activas."], ["Guest song requests will appear here.", "Las solicitudes de canciones aparecerán aquí."],
  ["Waiting to Enter the Queue", "Esperando para entrar en la cola"], ["In arrival order", "En orden de llegada"],
  ["Active Requests", "Solicitudes activas"], ["Pending and linked, in arrival order", "Pendientes y vinculadas, en orden de llegada"],
  ["In the VirtualDJ Queue", "En la cola de VirtualDJ"], ["Verified in real time", "Verificadas en tiempo real"],
  ["Completed / Finished", "Completadas / Finalizadas"], ["Actions can be undone and restored", "Las acciones pueden deshacerse y restaurarse"],
  ["Completed / Skipped", "Completadas / Omitidas"], ["Only Undo can return them to the rotation", "Solo Deshacer puede devolverlas a la rotación"],
  ["No songs in this section.", "No hay canciones en esta sección."], ["Artist not provided", "Artista no indicado"],
  ["Language not provided", "Idioma no indicado"], ["✓ Local file found", "✓ Archivo local encontrado"],
  ["Possible match", "Coincidencia posible"], ["Not available locally", "No disponible localmente"],
  ["✓ In VirtualDJ", "✓ En VirtualDJ"], ["⚠ In VDJ · local file missing", "⚠ En VDJ · falta el archivo local"],
  ["? VDJ queue not verified", "? Cola VDJ no verificada"], ["? VDJ not verified · local file missing", "? VDJ no verificado · falta el archivo local"],
  ["Adding to VirtualDJ…", "Agregando a VirtualDJ…"], ["Confirming in VirtualDJ…", "Confirmando en VirtualDJ…"],
  ["↻ Outside the queue", "↻ Fuera de la cola"], ["↻ Outside · local file missing", "↻ Fuera · falta el archivo local"],
  ["✓ Completed", "✓ Completada"], ["− Skipped", "− Omitida"], ["Skipped", "Omitida"],
  ["Processing…", "Procesando…"], ["SAVED SOURCE LINK", "ENLACE DE ORIGEN GUARDADO"], ["Open ↗", "Abrir ↗"],
  ["Check Queue Now", "Verificar cola ahora"], ["No — Re-add at the End", "No — Agregar de nuevo al final"],
  ["Yes — Keep It Outside", "Sí — Mantener fuera"], ["Resend to the End", "Reenviar al final"],
  ["Remove from VirtualDJ", "Eliminar de VirtualDJ"], ["Add to VirtualDJ", "Agregar a VirtualDJ"],
  ["Use This File", "Usar este archivo"], ["Search YouTube Options", "Buscar opciones en YouTube"],
  ["Scan Folder Now", "Escanear carpeta ahora"], ["Undo and Send to End", "Deshacer y enviar al final"],
  ["Undo Only · Keep Outside", "Solo deshacer · Mantener fuera"],
  ["Current VirtualDJ queue", "Cola actual de VirtualDJ"], ["awaiting confirmation", "esperando confirmación"],
  ["The Karaoke queue is empty or has not been verified yet.", "La cola Karaoke está vacía o todavía no se ha verificado."],
  ["Unmatched VirtualDJ item", "Pista propia de VirtualDJ"], ["Linked request", "Solicitud vinculada"],
  ["Searching for Karaoke/Lyrics versions…", "Buscando versiones Karaoke/Lyrics…"],
  ["Searching for a video with lyrics", "Buscando un video con letras"],
  ["Choose the version you prefer", "Elige la versión que prefieras"],
  ["Karaoke with lyrics", "Karaoke con letras"], ["Lyrics with vocals", "Letras con voz"],
  ["Copy This Link", "Copiar este enlace"], ["Options will appear here automatically.", "Las opciones aparecerán aquí automáticamente."],
  ["ROTATION PLAN B", "PLAN B DE ROTACIÓN"], ["Balanced Spanish and English Hits", "Éxitos equilibrados en español e inglés"],
  ["Use a local track for the EMCEE or find the best Karaoke link when it is not on disk.", "Usa una pista local para el EMCEE o busca el mejor enlace Karaoke cuando no esté en el disco."],
  ["Add for EMCEE", "Agregar para EMCEE"], ["Random Singer", "Cantante aleatorio"],
  ["Scan Folder", "Escanear carpeta"], ["Copy Karaoke Link", "Copiar enlace Karaoke"],
  ["Retry Karaoke Link", "Reintentar enlace Karaoke"], ["No reliable Karaoke version was found yet.", "Todavía no se encontró una versión Karaoke confiable."],
  ["Copy Karaoke", "Copiar karaoke"], ["Searching…", "Buscando…"], ["Search Karaoke", "Buscar karaoke"],
  ["The Superhost has not added favorites for this hotel yet.", "El Superhost todavía no ha agregado favoritos para este hotel."],
  ["The action could not be completed.", "No se pudo completar la acción."],
  ["This action is already being processed. Wait for confirmation.", "Esta acción ya se está procesando. Espera la confirmación."],
  ["Not yet", "Todavía no"], ["Just now", "Ahora mismo"], ["The song", "La canción"],
  ["The clock is at 0:00:00", "El reloj está en 0:00:00"],
  ["Select Start Activity to activate the clock", "Selecciona Iniciar actividad para activar el reloj"],
  ["Skipped songs are not included", "Las canciones omitidas no están incluidas"],
  ["Select Start Activity", "Selecciona Iniciar actividad"],
  ["The clock and end time will begin when the host starts the activity.", "El reloj y la hora de finalización comenzarán cuando el host inicie la actividad."],
  ["Time covered", "Tiempo cubierto"], ["You have enough confirmed time.", "Tienes suficiente tiempo confirmado."],
  ["Completed songs and tracks actually present in VirtualDJ cover the activity duration.", "Las canciones completadas y las pistas presentes en VirtualDJ cubren la duración de la actividad."],
  ["Close Requests Now", "Cerrar solicitudes ahora"], ["The VirtualDJ queue is empty.", "La cola de VirtualDJ está vacía."],
  ["Use the hit suggestions below for the EMCEE or a random singer.", "Usa las sugerencias de éxitos para el EMCEE o un cantante aleatorio."],
  ["Scan error", "Error de escaneo"], ["Scanning folder changes…", "Escaneando cambios en las carpetas…"],
  ["Disconnected", "Desconectado"], ["Sign in to Guest Star", "Inicia sesión en Guest Star"],
  ["Check connection", "Revisar conexión"], ["Checking rotation…", "Verificando rotación…"],
  ["Queue not verified", "Cola no verificada"], ["Select Synchronize to check the live queue.", "Selecciona Sincronizar para verificar la cola en vivo."],
  ["Ready to start", "Lista para iniciar"], ["Sign in to use this Bridge.", "Inicia sesión para usar este Bridge."],
  ["Choose the hotel, venue and activity assigned to this computer.", "Elige el hotel, lugar y actividad asignados a esta computadora."],
  ["Activity finished · queue preserved", "Actividad finalizada · cola conservada"],
  ["Link copied.", "Enlace copiado."], ["Copy this link:", "Copia este enlace:"],
  ["Saved link copied.", "Enlace guardado copiado."], ["Song restored", "Canción restaurada"],
  ["Song requeued", "Canción reenviada a la cola"], ["Song added to VirtualDJ", "Canción agregada a VirtualDJ"],
  ["Song removed from VirtualDJ", "Canción eliminada de VirtualDJ"], ["Song outside the rotation", "Canción fuera de la rotación"],
  ["VirtualDJ accepted the song. Guest Star is confirming the live queue and will not send a second copy.", "VirtualDJ aceptó la canción. Guest Star está confirmando la cola en vivo y no enviará una segunda copia."],
  ["Mark as Skipped", "Marcar como omitida"], ["Mark Skipped", "Marcar omitida"],
  ["Singer completed", "Cantante completado"], ["Song skipped", "Canción omitida"],
  ["Action undone", "Acción deshecha"], ["Searching for Karaoke/Lyrics versions…", "Buscando versiones Karaoke/Lyrics…"],
  ["The selected link was copied and saved with the request.", "El enlace seleccionado se copió y guardó con la solicitud."],
  ["The selected link was copied to the clipboard.", "El enlace seleccionado se copió al portapapeles."],
  ["Karaoke link selected", "Enlace Karaoke seleccionado"],
  ["No sufficiently reliable link was found yet. The Bridge will search again during synchronization.", "Todavía no se encontró un enlace suficientemente confiable. El Bridge volverá a buscar durante la sincronización."],
  ["The Bridge will not copy anything automatically; select Copy on the version you want.", "El Bridge no copiará nada automáticamente; selecciona Copiar en la versión que quieras."],
  ["The library is already being updated.", "La biblioteca ya se está actualizando."],
  ["Synchronization is already in progress.", "La sincronización ya está en curso."],
  ["Requests and the live VirtualDJ queue are synchronized.", "Las solicitudes y la cola en vivo de VirtualDJ están sincronizadas."],
  ["Complete the activity duration and transition settings before starting.", "Completa la duración y la transición de la actividad antes de iniciar."],
  ["Choose a permanent password", "Elige una contraseña permanente"],
  ["Set a permanent password before operating an event.", "Establece una contraseña permanente antes de operar un evento."],
  ["The new passwords do not match.", "Las contraseñas nuevas no coinciden."],
  ["Your password was changed.", "Tu contraseña fue cambiada."],
  ["Select Hotel", "Selecciona un hotel"], ["Select Venue", "Selecciona un lugar"], ["Select Activity", "Selecciona una actividad"],
  ["This Bridge is ready for the selected activity.", "Este Bridge está listo para la actividad seleccionada."],
  ["Log out of this Bridge?", "¿Cerrar sesión en este Bridge?"],
  ["The saved session will be revoked. Local library settings will remain on this Mac.", "La sesión guardada será revocada. La configuración de la biblioteca local permanecerá en esta Mac."],
  ["QR verified and generated on this Mac.", "QR verificado y generado en esta Mac."],
  ["Permanent hotel link copied.", "Enlace permanente del hotel copiado."],
  ["The public hotel page is not available yet.", "La página pública del hotel todavía no está disponible."],
  ["Activity administration is available to a Superhost.", "La administración de actividades está disponible para un Superhost."],
  ["Forget PIN", "Olvidar PIN"], ["Forget the PIN saved on this Mac?", "¿Olvidar el PIN guardado en esta Mac?"],
  ["Forget", "Olvidar"], ["The saved PIN was removed from the app.", "El PIN guardado fue eliminado de la aplicación."],
  ["Remove Password", "Eliminar contraseña"], ["Remove the saved VirtualDJ password?", "¿Eliminar la contraseña guardada de VirtualDJ?"],
  ["Remove", "Eliminar"], ["The saved VirtualDJ password was removed.", "La contraseña guardada de VirtualDJ fue eliminada."],
  ["Select at least one guest language for this activity.", "Selecciona al menos un idioma para los huéspedes en esta actividad."],
  ["Settings saved.", "Configuración guardada."], ["Guest Star Is Connected", "Guest Star está conectado"],
  ["VirtualDJ and Its Queue Are Connected", "VirtualDJ y su cola están conectados"],
  ["Finish this activity?", "¿Finalizar esta actividad?"], ["Start a new activity?", "¿Iniciar una actividad nueva?"],
  ["Archive and clear the current queue?", "¿Archivar y limpiar la cola actual?"],
  ["New requests will close, but the current queue and history will be preserved.", "Las solicitudes nuevas se cerrarán, pero la cola actual y el historial se conservarán."],
  ["The previous queue will be archived and the activity will start with an empty queue.", "La cola anterior se archivará y la actividad comenzará con una cola vacía."],
  ["All current requests will move to history. The permanent link and QR will not change.", "Todas las solicitudes actuales pasarán al historial. El enlace permanente y el QR no cambiarán."],
  ["Finish", "Finalizar"], ["Start New", "Iniciar nueva"], ["Archive and Clear", "Archivar y limpiar"],
  ["Activity started. The timer and end time are now running.", "Actividad iniciada. El temporizador y la hora de finalización ya están corriendo."],
  ["Requests are now open.", "Las solicitudes ahora están abiertas."], ["Requests are now closed.", "Las solicitudes ahora están cerradas."],
  ["Activity archived and local queue synchronized.", "Actividad archivada y cola local sincronizada."],
  ["Queue archived and cleared. The permanent link and QR did not change.", "Cola archivada y limpiada. El enlace permanente y el QR no cambiaron."],
  ["Activity finished. The current queue and history were preserved.", "Actividad finalizada. La cola actual y el historial se conservaron."],
  ["A new activity started with an empty active queue.", "Una actividad nueva inició con una cola activa vacía."]
];

const EXACT = new Map();
for (const [en, es] of PHRASES) {
  EXACT.set(`en:${en}`, en);
  EXACT.set(`es:${en}`, es);
  EXACT.set(`en:${es}`, en);
  EXACT.set(`es:${es}`, es);
}

function interpolateEnglishToSpanish(value) {
  const patterns = [
    [/^(\d+) sec ago$/, "hace $1 s"], [/^(\d+) min ago$/, "hace $1 min"],
    [/^(\d+) tracks$/, "$1 pistas"], [/^(\d+) requests$/, "$1 solicitudes"],
    [/^(\d+) in queue$/, "$1 en cola"], [/^Synced: (.+)$/, "Sincronizado: $1"],
    [/^Last scan: (.+)$/, "Último escaneo: $1"], [/^Live · updated (.+)$/, "En vivo · actualizado $1"],
    [/^Queue verified: (.+)$/, "Cola verificada: $1"], [/^Elapsed: (.+)$/, "Transcurrido: $1"],
    [/^In progress · requests open$/, "En curso · solicitudes abiertas"],
    [/^In progress · requests closed$/, "En curso · solicitudes cerradas"],
    [/^Activity in progress · started (.+)$/, "Actividad en curso · inició $1"],
    [/^Scheduled for (.+)$/, "Programada para $1"],
    [/^(\d+) live VDJ track · (.+) already performed$/, "$1 pista VDJ en vivo · $2 ya interpretado"],
    [/^(\d+) live VDJ tracks · (.+) already performed$/, "$1 pistas VDJ en vivo · $2 ya interpretado"],
    [/^The activity is over its duration by (.+)$/, "La actividad excedió su duración por $1"],
    [/^(.+) remaining$/, "$1 restantes"], [/^(.+) excluded as skipped$/, "$1 excluidos como omitidos"],
    [/^Over by (.+)$/, "Exceso de $1"], [/^(.+) missing$/, "Faltan $1"],
    [/^(\d+)% covered against (.+)$/, "$1% cubierto respecto a $2"],
    [/^(\d+)% · the rotation covers the activity$/, "$1% · la rotación cubre la actividad"],
    [/^(\d+)% covered by completed songs and the live queue$/, "$1% cubierto por canciones completadas y la cola en vivo"],
    [/^(\d+) tracks · empty queue$/, "$1 pistas · cola vacía"],
    [/^(\d+) track · next: (.+)$/, "$1 pista · siguiente: $2"],
    [/^(\d+) tracks · next: (.+)$/, "$1 pistas · siguiente: $2"],
    [/^Singer: (.+)$/, "Cantante: $1"], [/^⚠ (.+) · file unavailable$/, "⚠ $1 · archivo no disponible"],
    [/^Request (\d+) · record (\d+)$/, "Solicitud $1 · registro $2"],
    [/^Request (\d+) by arrival order$/, "Solicitud $1 por orden de llegada"],
    [/^Arrival #(\d+)(.*) · requested total at arrival (.+)$/, "Llegada #$1$2 · total solicitado al llegar $3"],
    [/^Arrival #(\d+)(.*) · cumulative queue (.+) · estimated turn (.+)$/, "Llegada #$1$2 · cola acumulada $3 · turno estimado $4"],
    [/^ · row (\d+)$/, " · fila $1"], [/^Language: (.+)$/, "Idioma: $1"],
    [/^Language not provided · Track (.+) \+ transition (.+) = (.+)$/, "Idioma no indicado · Pista $1 + transición $2 = $3"],
    [/^Language: (.+) · Track (.+) \+ transition (.+) = (.+)$/, "Idioma: $1 · Pista $2 + transición $3 = $4"],
    [/^Track (.+) \+ transition (.+) = (.+)$/, "Pista $1 + transición $2 = $3"],
    [/^✓ Position (\d+) in VirtualDJ$/, "✓ Posición $1 en VirtualDJ"],
    [/^⚠ Position (\d+) · local file missing$/, "⚠ Posición $1 · falta el archivo local"],
    [/^(\d+)% match$/, "$1% de coincidencia"], [/^OPTION (\d+)$/, "OPCIÓN $1"],
    [/^We found (\d+) option\. (.+)$/, "Encontramos $1 opción. $2"],
    [/^We found (\d+) options\. (.+)$/, "Encontramos $1 opciones. $2"],
    [/^Undo and Restore Position (\d+)$/, "Deshacer y restaurar posición $1"],
    [/^Local: (.+)$/, "Local: $1"], [/^Guest identifier (.+)$/, "Identificador del huésped $1"],
    [/^(.+) · Singer: (.+) · Unmatched VirtualDJ item$/, "$1 · Cantante: $2 · Pista propia de VirtualDJ"],
    [/^(.+) · Singer: (.+) · Linked request$/, "$1 · Cantante: $2 · Solicitud vinculada"],
    [/^Guest (.+)$/, "Huésped $1"], [/^The action could not be completed: (.+)$/, "No se pudo completar la acción: $1"],
    [/^VirtualDJ returned a technical Network Control error while reading (.+)\. The previous valid queue was preserved; restart Network Control or VirtualDJ and synchronize again\.$/, "VirtualDJ devolvió un error técnico de Network Control al leer $1. Se conservó la última cola válida; reinicia Network Control o VirtualDJ y vuelve a sincronizar."],
    [/^Library updated: (\d+) tracks found\.$/, "Biblioteca actualizada: se encontraron $1 pistas."],
    [/^Everything is working\. Service (.+) returned (\d+) active requests\.$/, "Todo funciona. El servicio $1 devolvió $2 solicitudes activas."],
    [/^Karaoke queue verified · time (.+)$/, "Cola Karaoke verificada · hora $1"],
    [/^Everything is working\. The Karaoke queue returned (\d+) songs?(.*)\.$/, "Todo funciona. La cola Karaoke devolvió $1 canciones$2."],
    [/^Enlace de (.+) copiado\.$/, "Enlace de $1 copiado."]
  ];
  return patterns.reduce((result, [pattern, replacement]) =>
    pattern.test(result) ? result.replace(pattern, replacement) : result, value);
}

function interpolateSpanishToEnglish(value) {
  const patterns = [
    [/^hace (\d+) s$/, "$1 sec ago"], [/^hace (\d+) min$/, "$1 min ago"],
    [/^(\d+) pistas$/, "$1 tracks"], [/^(\d+) solicitudes$/, "$1 requests"],
    [/^Enlace de (.+) copiado\.$/, "Link for $1 copied."],
    [/^Nueva ronda aleatoria lista; no se repetirá un tema antes de completar la vuelta\.$/, "New random round ready; no song will repeat before the round is complete."],
    [/^Esta lista todavía no tiene temas\. Agrega favoritos desde Superhost\.$/, "This list has no songs yet. Add favorites from Superhost."]
  ];
  return patterns.reduce((result, [pattern, replacement]) =>
    pattern.test(result) ? result.replace(pattern, replacement) : result, value);
}

export function normalizeBridgeLanguage(value) {
  return String(value || "").toLowerCase() === "en" ? "en" : "es";
}

export function translateBridgeText(rawValue, requestedLanguage = "es") {
  const raw = String(rawValue ?? "");
  const match = raw.match(/^(\s*)(.*?)(\s*)$/s);
  const [, before, value, after] = match || ["", "", raw, ""];
  if (!value) return raw;
  const language = normalizeBridgeLanguage(requestedLanguage);
  const exact = EXACT.get(`${language}:${value}`);
  const translated = exact ?? (language === "es"
    ? interpolateEnglishToSpanish(value)
    : interpolateSpanishToEnglish(value));
  return `${before}${translated}${after}`;
}

export function createBridgeI18n({ root = document, language = "es" } = {}) {
  let currentLanguage = normalizeBridgeLanguage(language);
  const sourceText = new WeakMap();
  const renderedText = new WeakMap();
  const sourceAttributes = new WeakMap();
  const renderedAttributes = new WeakMap();
  const protectedSelector = [
    "#superhostWorkspace", "#tenantPath", "#selectedActivityName",
    ".song", ".artist", ".singer-name", ".request-comment",
    ".source-panel a", ".match-file strong", ".candidate strong",
    ".youtube-item strong", ".hit-card strong", ".hit-card > div > p",
    ".vdj-live-row strong"
  ].join(",");

  function skipped(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || element.closest("script,style,[data-no-i18n]")) return true;
    if (element.closest(protectedSelector)) return true;
    return element.tagName === "OPTION" && Boolean(element.value);
  }

  function translateTextNode(node) {
    if (skipped(node)) return;
    const raw = node.nodeValue || "";
    if (raw !== renderedText.get(node)) sourceText.set(node, raw);
    const source = sourceText.get(node) ?? raw;
    const output = translateBridgeText(source, currentLanguage);
    renderedText.set(node, output);
    if (raw !== output) node.nodeValue = output;
  }

  function translateAttributes(element) {
    if (skipped(element)) return;
    const names = ["placeholder", "title", "aria-label", "alt"];
    const sources = sourceAttributes.get(element) || {};
    const rendered = renderedAttributes.get(element) || {};
    for (const name of names) {
      if (!element.hasAttribute(name)) continue;
      const raw = element.getAttribute(name) || "";
      if (raw !== rendered[name]) sources[name] = raw;
      const output = translateBridgeText(sources[name] ?? raw, currentLanguage);
      rendered[name] = output;
      if (raw !== output) element.setAttribute(name, output);
    }
    sourceAttributes.set(element, sources);
    renderedAttributes.set(element, rendered);
  }

  function refresh(target = root) {
    if (target.nodeType === Node.TEXT_NODE) {
      translateTextNode(target);
      return;
    }
    if (target.nodeType !== Node.ELEMENT_NODE && target.nodeType !== Node.DOCUMENT_NODE && target.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (target.nodeType === Node.ELEMENT_NODE) translateAttributes(target);
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
      node = walker.nextNode();
    }
    document.documentElement.lang = currentLanguage;
    const selector = document.querySelector("#uiLanguageSelect");
    if (selector && selector.value !== currentLanguage) selector.value = currentLanguage;
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateTextNode(record.target);
      else if (record.type === "attributes") translateAttributes(record.target);
      else record.addedNodes.forEach((node) => refresh(node));
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label", "alt"]
  });

  refresh();
  return {
    getLanguage: () => currentLanguage,
    locale: () => currentLanguage === "es" ? "es-DO" : "en-US",
    setLanguage(nextLanguage) {
      currentLanguage = normalizeBridgeLanguage(nextLanguage);
      refresh();
    },
    refresh,
    translate: (value) => translateBridgeText(value, currentLanguage),
    disconnect: () => observer.disconnect()
  };
}
