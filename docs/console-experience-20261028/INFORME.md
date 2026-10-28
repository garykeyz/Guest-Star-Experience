# Guest Star Interactive Entertainment — entrega 4.7.0

**Entrega final: build471, fuente5c58e8a8966db0e1a531350b7be2c5675e65ecd8, Workerfabb7592-a64c-470a-b921-956fff62f216. App instalada y abierta; DMG verificado.**

Fecha: 28 octubre 2026. Fuente real: `release-audit-20261027/release-source`, rama de entrega `codex/interactive-shows-20261028`, basada en `codex/connectivity-p0-20261027`. La carpeta histórica `candidate` no se utilizó. Este documento distingue ejecución local controlada, hardware nativo y comprobaciones de producción.

## A. Arquitectura implementada

La nueva consola añade Home, Hotel Select, Activity Select, Experience Select, selección del motor de Karaoke, Game Arena, Show Director, Prepare Experience y Quick Menu. La máquina de navegación valida permisos, contexto y transiciones. Menús y retorno al show conservan el motor montado, solicitudes y actividad. El estado operativo sigue procediendo de los servicios existentes; el almacenamiento de navegación sólo recuerda presentación por usuario y contexto.

El núcleo de juegos es autoritativo en Cloudflare: un `GuestStarGames` por hotel, venue, actividad y ocurrencia. El registro contiene módulos ejecutables con reglas versionadas, validación de configuración, preparación y evaluación. Reducers de juegos y shows trabajan sobre snapshots separados, con transacciones SQLite del Durable Object. Los eventos y resultados originales se conservan; Show Composer consume contribuciones normalizadas mediante un ledger independiente.

Show Composer admite `MIXED_COMPETITION`, `OPEN_STAR_NIGHT` y `FEATURED_SHOW`; segmentos programados, preparados, activos, pausados, completados, omitidos y cancelados. Admite inscripción por categorías, equipos voluntarios, preparación anticipada, inserción y orden de segmentos futuros, selección por categoría/cohorte, clasificaciones y premios. Una partida fuente puede cerrar su segmento desde resultados de ronda, sin una ceremonia autónoma de ganador. Las reglas de un segmento se bloquean al prepararlo. Las correcciones excepcionales necesitan permiso, confirmación y motivo, y sólo se aceptan antes de evaluar la ronda.

Audience Power utiliza el mismo motor de votos para salvar una estrella, elegir siguiente juego, comodín, contrincante, favorito, final y canción. Los resultados modifican realmente cohortes, orden, premios o la canción de un reto musical futuro de una sola ronda. Una decisión pendiente bloquea la preparación del destino correspondiente. La cancelación queda auditada. Los empates de decisiones públicas se resuelven por sorteo criptográfico del servidor, declarado previamente y registrado.

Las plantillas son versiones inmutables por hotel. Crear un show copia la versión exacta; publicar otra versión no modifica shows existentes. Guardado y clonación exigen Superhost. El Superhost puede habilitar formatos por hotel o mediante una excepción para la actividad; el Host recibe el catálogo autorizado.

## Modelo de datos

| Entidad | Autoridad y relación |
| --- | --- |
| Actor | Host/dispositivo autorizado o identidad derivada del dispositivo de la sesión pública existente |
| Game | Configuración, reglas/versiones, participantes, equipos, jurado, rondas, respuestas, votos y ledger |
| Show | Programa de segmentos, inscripciones, cohortes, contribuciones, decisiones y premios |
| Segment | Juego fuente y política de escala, peso, origen de resultado y crédito de equipos |
| Round | Tiempo del servidor, escena, respuestas/votos únicos y evaluación confirmada |
| Template | Hotel + ID + versión inmutable; concurrencia mediante versión esperada |
| Recurso local | UUID opaco por contexto; ruta privada sólo en la Mac, sin subir medios |

La migración 0008 crea sesiones de juego, eventos y archivos de estado por partes en D1. La 0009 añade sesiones/eventos/archivos de shows, plantillas versionadas, oferta del hotel y excepciones de actividad. No cambia tablas de solicitudes o reproducción. SQLite del Durable Object conserva snapshots, eventos, comandos, tickets y presentación. La réplica D1 se agrupa mediante alarmas, sin escribir por cada tick visual.

## Protocolo y recuperación

`POST /api/games` reutiliza autenticación Host o el token de actividad y `guestDeviceId` existentes. Roles, IDs y contexto se derivan en el servidor. No se aceptan los roles enviados por clientes. Cada comando lleva protocolo, ID único, tipo, sesión/ronda, payload y revisión esperada para controles del Host. Snapshot, eventos y confirmación de idempotencia se guardan atómicamente. Repetir el mismo comando devuelve ACK; reutilizar su ID con contenido distinto se rechaza.

Los WebSockets sólo transportan invalidaciones y ping/pong; las acciones usan HTTP autenticado con ACK explícito. Tickets de un uso duran 30 segundos y la conexión renueva autorización cada 60 segundos. Hay reconexión con espera progresiva y reconciliación HTTP al perder conexión. El reloj visual deriva de la hora del servidor. Las lecturas retrasadas no sustituyen revisiones ya confirmadas. Cambiar cuenta o contexto elimina los controladores y caches del contexto anterior.

La identidad del huésped sigue siendo la del dispositivo de la sesión Guest Star. Se limita una respuesta/voto por identidad y ronda; esto no certifica una persona física única entre varios dispositivos.

## B. Diseño visual y capturas

Capturas reales del navegador, con hoteles y participantes de un entorno local aislado, sin alterar actividades de producción:

- [Home](capturas/home.png), [Hotel Select](capturas/hotel-select-a.png), [Activity Select](capturas/activities.png).
- [Experience Select](capturas/experiences.png), [Karaoke](capturas/karaoke-engine.png), [Game Arena](capturas/game-arena.jpg).
- [Show Director](capturas/director-segment.png), [Prepare Experience](capturas/prepare-experience.png), [reglas de segmento](capturas/segment-rules.png).
- [Request móvil](capturas/public-mobile-show.png), [respuesta confirmada](capturas/public-answer-accepted.png).
- [Star Screen](capturas/star-screen-show.png) y [Preview](capturas/preview-show.png): misma escena y canvas existente de 1920×1080.

Se reutilizan logos oficiales, fuentes y tokens existentes. Los nuevos pesos tipográficos son 400–600. No se añadieron fuentes ni dependencias directas de runtime de la aplicación.

## C. Branding corporativo

Se aplican los colores y logo autorizados del hotel seleccionado, con fallback Guest Star si faltan o son inválidos. El tema queda limitado a la consola; no reescribe el branding corporativo guardado. El cache se separa por hotel y usuario, se limpia al cerrar sesión y no hereda colores de otro hotel.

La prueba visual guardó dos temas mediante la API real del backend aislado y seleccionó sus actividades desde la consola: hotel A `#168a68`, hotel B `#b44c1e`, ambos confirmados mediante estilo calculado del navegador, sin errores JavaScript. [Hotel A](capturas/experience-hotel-a.png) · [Hotel B](capturas/experience-hotel-b.png).

## D. Integraciones

- Host: los menús llaman selección/autorización, preparación, preferencias y controles ya existentes. Las inscripciones de shows no son la cola de karaoke.
- Request: un componente añadido dentro de la sesión pública existente ofrece categorías, respuestas y votos. No añade PIN, login ni otra aplicación pública.
- Kiosko: conserva solicitudes; la competición y el voto personal requieren teléfono porque el kiosko es compartido.
- Star Screen/Preview: una capa dentro del canvas existente presenta registro, desafío, participantes, reloj, clasificación, clasificados, premiación y cierre. Adquirir presentación es explícito y se rechaza con reproducción activa o estado de Bridge no confirmado. Regresar a Karaoke libera la presentación.
- Player: fragmentos usan un deck opcional del mismo `AVAudioEngine` y la clase nativa existente. Exclusión de reproducción entre experiencias, UUID de recurso, ventana de hasta 120 segundos y recuperación/liberación de propietario. No se usa un reproductor HTML alternativo.
- Bridge: se conservan motor, cola física y controles existentes. Los fragmentos automáticos del juego requieren Player; las actuaciones con Bridge utilizan sus controles originales y conexión confirmada.
- Aplausómetro: captura real de micrófono con consentimiento, calibración ambiente y análisis RMS/transitorios/banda ancha, sin salida al altavoz. Rechaza datos insuficientes, silencio, saturación y señales sostenidas en las pruebas. Es una estimación acústica heurística; no un clasificador certificado de aplausos ni una medición de afinación.

## Catálogo funcional

El registro contiene 26 formatos ejecutables y Star Pitch deshabilitado explícitamente. Los formatos comparten mecánicas; no son 26 motores independientes.

| Grupo | Formatos | Evidencia y límite |
| --- | --- | --- |
| Preguntas | Music Trivia, Guess the Song, Finish the Lyrics, Mystery Singer, Music Time Machine, Mystery Star | Evaluación autoritativa, pistas, respuestas únicas; fragmentos requieren recursos locales autorizados |
| Equipos | Team Battle, Battle of the Sexes, Generation Clash, Nations Battle, Guest vs Staff, Family Faceoff | Puntuación por equipo; selección voluntaria, sin asignar identidad personal por sexo o nacionalidad |
| Escenario | Karaoke Battle, Star Moment, Star Voice, Star Talent, Star Lip Sync, Star Dance Battle, Star Impersonator, Comedy Star, Star Charades, Star Hot Seat | Votos/jurado/aplausómetro ponderados, rondas y clasificación; el contenido escénico lo interpreta el concursante |
| Sorteos/decisiones | Random Song Challenge, Duet Roulette, Audience Choice / Spin the Wheel | Sorteos en servidor, exclusiones, no repetición, decisiones confirmadas |
| Buzzer | Star ID / Star Buzzer | Primer pulsador autoritativo y pregunta con fragmento; no reconocimiento automático de grabaciones |
| Pendiente | Star Pitch | No puede iniciarse; falta análisis técnico de afinación validado |

Las pruebas de dominio cubren los once juegos base y reglas compartidas. El show mixto HTTP ejercita cinco segmentos heterogéneos. Esto no equivale a haber producido físicamente un evento de cada formato.

## E. Pruebas y carga

Resultados y límites de la validación final se registran en el cierre de entrega. Evidencia ya confirmada:

- Dominio de Game Engine y Show Composer: 38/38, incluyendo 50/100/150/250 participantes controlados, respuestas/votos únicos, puntuaciones esperadas, recuperación, aislamiento, rondas, siete decisiones públicas y reglas de importación.
- HTTP local real: Cloudflare workerd + Durable Object SQLite + D1 + autorización de plataforma. 100 participantes, cinco rondas, 500 respuestas; ganador esperado de 500 puntos; reintentos deduplicados y 1126 eventos persistidos sin duplicados.
- Show HTTP local: 150 accesos reales mediante el mismo PIN; 300 respuestas, 426 papeletas escénicas, cuatro finalistas y campeón esperado Huésped 4; cinco segmentos dentro de la misma actividad; resultados fuente conservados y contribuciones normalizadas.
- 150 WebSockets autenticados sobre TCP local, 150 conexiones abiertas y 150/150 pong, cierre controlado. No se extrapola a 150 teléfonos físicos o WiFi de hotel.
- Regresión del Worker completo: 200 solicitudes aceptadas sin pérdidas; 352 registros persistidos y visibles en Host, incluyendo entrega concurrente, reconexión y reinicio del proceso Host local.
- Navegador: creación de show, formulario de preguntas, reglas, inscripción móvil, pregunta, respuesta confirmada de 100 puntos y cierre del show por HTTP/D1 reales del entorno aislado; sin errores JavaScript. Preview y Star Screen comparten la escena confirmada.
- Nativo ARM64: compilación y prueba con WAV silencioso, máster silenciado, límite de render 0.4–1.0 s, exclusión de reproducción y liberación de propietario, usando un AVAudioEngine. No se reprodujeron canciones de huéspedes para las pruebas.
- Tipos TypeScript, Next de producción, OpenNext y Wrangler dry-run aprobados. La prueba del Worker detectó un manifiesto ausente en OpenNext 1.20.2 con Next16.4; se actualizó el adaptador a 1.20.12 y Wrangler a 4.154.0. Se fijó glob10.5.0 únicamente bajo node-minify/core. `npm audit`: cero vulnerabilidades.

No se certificó un salón con 150 teléfonos, acústica real, micrófono de evento, reconocimiento musical o afinación. El escenario HTTP es una prueba local controlada, no una prueba en producción con público.

## F. Archivos y propósito

- `guest-star-bridge/public/experience-console.*`, `shared/experience-navigation.js`, `shared/console-theme.js`: navegación y branding.
- `lib/guest-star/games/*`: reglas, autoridad, modelos, programa, plantillas y persistencia.
- `worker-games-scope.mjs`, `worker.mjs`, `wrangler.jsonc`, migraciones0008/0009: ruta aditiva e infraestructura.
- `components/GameParticipation.tsx`, CSS e inserción en `SessionRequestExperience.tsx`: participación desde la sesión pública.
- `public/game-host.js`, `show-director.js`, `shared/game-client*`, `game-host-actions.js`, `game-snapshots.js`: control, ACK, reconexión y revisiones.
- `src/game-proxy.mjs`, `game-media-registry.mjs`, rutas nuevas de `src/server.mjs`: adaptadores locales con contexto del servidor.
- `public/game-media-adapter.js`, guardas limitadas en `player-beta.js`, ampliación de `macos/GuestStarNativeHost.m`: servicio nativo compartido.
- `public/game-scenes*`, dos inclusiones en `star-screen.html`: capa de escenas; `star-screen.js` permanece intacto.
- `applause-meter.js`, `shared/applause-analysis.js`: medición de entrada separada del Player.
- `scripts/game-engine-test.mjs`, `show-composer-test.mjs`, `game-engine-http-test.mjs`, `game-native-smoke.py`, tests nuevos de Bridge: evidencia reproducible.
- `package.json/package-lock.json`, adaptación de Miniflare en `local-d1-http-load-test.mjs`: compatibilidad de compilación y pruebas, sin sustituir aserciones funcionales.

## G. Entrega y restauración

Checkpoint del arreglo de carpetas previamente instalado: `4a50ce6`. Núcleo y participación: `9be2407`. Consola/nativo/adaptadores: `cce6a790f63a706f65e5a1975c09eaebb4f461e8`.

Primer paquete generado: 4.7.0/build470, ARM64, macOS15.5+, bundle `com.gstarxp.guest-star`, firma ad hoc, sin notarización. Huella del bundle: `404b6134351599f88a3c87b89f034ce58340f2f3c2ab943f3ffc083370299846`. No se presenta como distribución notarizada.

Antes de promover se creó copia verificada de la app instalada, exportación D1 privada y registro de 25 solicitudes, biblioteca58, actividad detenida y reproducción detenida. El rollback del Worker anterior corresponde a `8a159f8e-d13a-4d67-aa41-2536b38582b4`; los nuevos objetos/tablas son aditivos y no se deben borrar al revertir código.

Las rutas privadas de respaldo están en `console-game-engine-20261028/rollback`, fuera de Git. No se publican credenciales, exportaciones de usuarios ni enlaces temporales de descarga. La versión efectivamente desplegada/instalada se registra al final de la entrega; generar un paquete no confirma por sí solo instalación o despliegue.

## H. Pendientes y alcance comprobado

- Validación acústica presencial del aplausómetro y su calibración en distintos micrófonos/salones. Mantener ponderación pública/jurado como opción principal hasta validar el entorno.
- Star Pitch, reconocimiento automático de música, análisis vocal avanzado y efectos adicionales no se simulan ni se declaran terminados.
- Los medios de una plantilla son referencias del contexto local original: para reutilizar formatos musicales en otra actividad se deben volver a vincular recursos autorizados. No se transfieren archivos ni rutas privadas entre hoteles.
- La prueba masiva no certifica WiFi, dispositivos físicos, percepción sonora ni continuidad durante una actuación real de público. La suite valida contratos y regresiones; no sustituye ensayo técnico de evento.
- Los shows y actuaciones no se sincronizan como cola de VirtualDJ. Su ejecución musical conserva los controles del motor seleccionado.

## Cierre inicial verificado — build470, sustituido por build471

- Suite final Bridge: **549/549**, cero fallos, omitidos o cancelados. Dominio: **38/38**. La aserción de versión visible detectó el texto antiguo del encabezado durante el incremento de versión; se corrigió la interfaz y se repitió la suite completa, sin omitir la prueba.
- Migraciones remotas 0008 y0009 aplicadas correctamente. Worker desplegado: **3884c127-ab5c-4fcf-9f45-b5e77997a14e**, etiqueta `guest-star-4.7.0`, código fuente `cce6a79`. Sitio: [request.gstarxp.com](https://request.gstarxp.com). Presupuesto del handler: 3,880,459 bytes / 1,147,272 gzip; sin traducciones públicas filtradas al runtime.
- Producción: `/` y `/join` responden200; `/api/games` rechaza anónimo con403 y rechaza correctamente con409/`ACTIVITY_UNAVAILABLE` la actividad real seleccionada que ya estaba finalizada. No se inició una actividad real ni se introdujeron resultados ficticios en producción. La validación masiva sigue siendo local controlada.
- App **4.7.0/build470** instalada en `/Applications/Guest Star Experience.app`, firma deep/strict verificada y abierta en Home. Autenticación conservada. Configuración JSON idéntica antes/después. **25 solicitudes con los mismos IDs, estados, revisiones y orden; biblioteca58 y vigilancia activa**. Reproducción y actividad detenidas. El arranque administrativo no monta un motor hasta entrar a operación; no se cambió la preferencia guardada de reproducción.
- El archivo protegido `player-media-preferences.js` es idéntico al de la app reparada previa. El checkpoint separado conserva íntegros los cambios de indexación y vigilancia de carpetas.
- DMG generado mediante el proceso existente, verificado, montado de sólo lectura y con firma/procedencia cotejadas: `Guest-Star-Experience-4.7.0-arm64.dmg`. SHA-256: **a573bad7aa370f27923f7c59b586a22a886a7292adbee19c5a51a84d2518e83a**. Ubicación local: `console-game-engine-20261028/`. El DMG estable anterior4.6.1 no se reemplazó.

La captura nativa de la app instalada se conserva localmente en `console-game-engine-20261028/installed-home.png`. Las capturas versionadas de este informe usan únicamente el entorno sintético aislado. Las pruebas auxiliares se ejecutaron con Node22.22.0. La app queda abierta, sin iniciar reproducción, VirtualDJ ni otra actividad.

La PR previa49 de la entrega4.6.1 sigue abierta. Esta entrega se conserva en una rama separada y una PR apilada sobre su base, para no ampliar ni reescribir esa revisión existente. El pipeline de validación admite esa base; el evento pull_request sigue omitiendo despliegue y publicación automáticos.

Pruebas reproducibles: `npm run test:games`, `npm run test:games:http`, `npm run test:d1` y `npm test` dentro del Bridge. La CI de la PR incluye las nuevas suites de dominio/HTTP; su resultado hospedado se debe distinguir de las pruebas locales aprobadas.

Revisión build471: la unión de clasificados se puede configurar, guardar y asignar a Grand Final desde el Director. [Captura real de esa selección](capturas/mixed-final-qualification.jpg). El catálogo usa todos los formatos autorizados recibidos del servidor, sin limitarse a los nueve descriptores de la fase inicial. Se retiró el texto obsoleto que afirmaba que los juegos estaban pendientes. Una aserción de carga que suponía empate por coincidencia de milisegundo se corrigió: ahora contrasta la decisión con los tiempos reales confirmados y exige empate o ganador correcto según corresponda, manteniendo íntegros los totales de puntos y deduplicación.


## Entrega final — build471

Se completó y verificó desde la consola la creación de una regla que une los clasificados de Lip Sync y talento y su asignación persistente a Grand Final. Se retiró el mensaje obsoleto de juegos pendientes y el catálogo muestra todos y sólo los formatos autorizados recibidos del servidor. La captura nueva usa el entorno aislado; no se cambiaron participantes reales.

- Fuente de app y Worker: **5c58e8a8966db0e1a531350b7be2c5675e65ecd8**. App4.7.0/build471, bundle**edc3bd85484aed3b73095952d127b5af152afbebca8ffee1679c6b564274d837**. Firma ad hoc deep/strict verificada, ARM64macOS15.5+, sin notarización.
- Worker definitivo: **fabb7592-a64c-470a-b921-956fff62f216**, etiqueta `guest-star-4.7.0-build471`. No hicieron falta otras migraciones. Además de los rechazos correctos de actividad cerrada/anónimo, una lectura autenticada de una actividad autorizada disponible obtuvo **HTTP200,27definiciones,0juegos,0shows** del Durable Object en producción. Esa comprobación no inició actividades ni creó partidas/resultados ficticios.
- Preservación posterior a la segunda instalación: autenticación conservada,25solicitudes idénticas por digest de IDs/estados/revisiones/orden; biblioteca58/realtime=true; actividad y reproducción detenidas. La app queda abierta en Home.
- Suite de dominio ampliada: **38/38**. El escenario HTTP de150identidades vuelve a pasar creando las reglas de clasificación mediante comandos del Director, incluida la unión de cohortes. Los27casos enfocados de navegación/adaptadores/entrada vuelven a pasar; la suite íntegra549/549 se conserva como regresión previa y se replica en CI de esta revisión.
- DMG final: `console-game-engine-20261028/Guest-Star-Experience-4.7.0-build471-arm64.dmg`. SHA-256: **365c42d333ce4825704f42a14bb2615bc4bd4caef1205c0f3894c1bea37add9d**. Verificado con hdiutil, montaje de sólo lectura, firma y procedencia exacta. El DMG470intermedio se trasladó al rollback privado; el release público4.6.1 sigue intacto.
- Captura nativa final: `console-game-engine-20261028/installed-home-build471.jpg`. La validación hospedada corresponde al código5c58e8a; su resultado final se registra en la PR50 y el cierre de continuidad, sin confundirlo con las pruebas locales.

CI hospedada del código final **5c58e8a** aprobada por completo: [GitHub Actions40669880941](https://github.com/garykeyz/Guest-Star-Experience/actions/runs/40669880941). Regresiones549/549, dominio38/38,150WS/pongs, escenario150participantes, tipos, D1, Next, OpenNext, presupuesto y dry-run aprobados en Linux; compilación nativa ARM64, firma y DMG aprobados también en macOS. El pipeline de PR omitió correctamente despliegue/publicación automáticos: la instalación y despliegue efectivos se verificaron por separado como se describe arriba. La revisión posterior del informe sólo cambia Markdown, sin modificar los inputs del código validado.
