# Auditoría previa — 28 octubre 2026

Base f423f9a, rama codex/connectivity-p0-20261027, worktree release-source inicialmente limpio. Instalada4.6.1/build462: public/app.js coincide. Runtime ~/Library/Application Support/Guest Star/bridge, loopback8787. Preflight: Superhost autenticado, actividad detenida, motor sin seleccionar,25solicitudes. candidate histórico no se utiliza. Checkpoint base conservado en Git.

## Arquitectura y reutilización

Host nativo: guest-star-bridge/macos/GuestStarNativeHost.m, supervisor y build_release_46.py. Frontend public/index.html/app.js, rutas / y /operate en src/server.mjs; mountWorkspace carga un único motor bajo demanda. Superhost public/superhost.js y superhost-branding.css; inicio administrativo preservado. account.selection contiene hoteles/venues/actividades autorizados; POST /api/auth/selection valida servidor. entry-flow.js resuelve selección/recuperación; activity-contexts persiste contexto operativo; modo libre tiene UUID independiente. /api/entry/prepare modifica resolución del motor: nunca invocarlo por abrir un menú durante show.

Scheduler public/activity-automation.js y prepare-session.js; backend lib/guest-star/d1-actions.ts y /api/activity/* conservan revisiones/apertura/duración/inicio/finalización. Menús no llaman start/finish automáticamente. Karaoke usa /api/activity/mode; Player public/player-beta.js y audio macOS; Bridge public/bridge-operations.js y src/virtualdj*.mjs conservan cola real#1, autocarga y terminales. No se reescriben motores.

Request/Kiosko: app/request, app/kiosk y componentes web; host-activity-access.js y qr-ui.js reutilizan PIN/QR. Star Screen/Preview: star-screen*.js/canvas canónico y controles existentes. Menú no cambia salida/overlays.

Infra: Next16.4.3, React19, OpenNext, worker.mjs y wrappers session/lyrics, D1 GUEST_STAR_DB y Durable Object GuestStarRealtime, WebSocket/SSE. No hacen falta cambios backend, auth, tablas ni migraciones.

Branding: shared/branding-theme.js y brand-image-url.js, HotelBranding primaryColor/secondaryColor/accentColor/hotelLogoUrl/teamLogoUrl. Superhost posee cache autorizado; Host recibe tenant.branding. Si falta configuración de otro hotel, usar base hasta confirmación de contexto; nunca transportar tema anterior. Inter/ui-sans-serif y fuentes del sistema existentes. Colores oficiales del CSS Superhost #ff2d95/#8b3dff/#00c8ff. Fallback compartido blanco/negro permanece para compatibilidad; nuevo ámbito de consola extiende tokens --gs-* sin alterar Star Screen. Assets oficiales public/branding; Logo2 aportado contiene masters para cotejo. Pesos nuevos400–600, sin dependencias.

## Rutas críticas y regresiones

- Login/Superhost ↔ Host: superhost-entry, entry-flow, mode-selection-flow.
- Hotel/venue/actividad/recuperación: activity-context, context-isolation; nuevas pruebas de máquina, permisos, restauración y bloqueo durante show.
- Tema: branding-theme, brand-image-url; nuevos casos parciales/inválidos/contraste/aislamiento/offline.
- Request/PIN/reconexión: cloud-realtime, server-integration, host-activity-access, request-order, queue-reconcile y D1/build.
- Cola: virtualdj*, queue-presence/queue-state, siempre aislados; no operar cola real para pruebas.
- Player/Star Screen: player-runtime/player-queue-ui/player-continuity/star-screen-canvas/star-screen-presentation. QA de menú verifica conservación de nodos/actividad/solicitudes.
- Scheduler: activity-automation, prepare-session y server integration; navegación no controla timers.
- Game Registry: nueve juegos pendientes, sin inicio ficticio; contratos extensibles.
- Rendimiento: render por firma sólo con menú abierto, sin polling propio ni animación continua. Carga100clientes y verificación audiovisual física deben reportarse según evidencia nueva, sin extrapolar auditorías previas.

Plan: tema → máquina/registro → Home/hoteles/actividades → experiencias/motores → catálogo/Director → preparación/quick menu → tests/UI/build/paquete. Persistencia nueva sólo de presentación versionada por usuario/contexto; backend conserva fuente operativa. Instalación requiere suite íntegra, reproducción detenida, respaldo/rollback y firma válida. No promover con regresiones.

## Ampliación posterior del alcance

Los documentos siguientes revocaron el catálogo exclusivamente pendiente y añadieron el motor funcional y Show Composer. Por ello se implementaron nuevas rutas `/api/games`, un Durable Object separado y migraciones aditivas 0008/0009. La autorización reutiliza la plataforma real, no una segunda autenticación. La auditoría inicial anterior describe el alcance de la primera fase; el informe de entrega recoge la implementación ampliada.

El arreglo de carpetas de karaoke realizado e instalado por el otro trabajo se conserva íntegro en un checkpoint independiente `4a50ce6`. No se atribuye a esta implementación. Las únicas ampliaciones posteriores de `server.mjs` son los imports/rutas de juegos y la versión 4.7.0.
