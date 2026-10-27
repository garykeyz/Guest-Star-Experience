# Auditoría real de conectividad — 27 de octubre de 2026

**Estado: correcciones documentadas y código publicado para revisión; promoción a estable bloqueada.** La aplicación habitual quedó restaurada en `/Applications/Guest Star Experience.app`, versión 4.6, bundle `450c1dd38bb9bb3387b2d791fce3473290b5a54cb33a48d9cacb65fda8ab6ce8`, con las mismas tres solicitudes y la actividad detenida. No se desplegó ningún cambio en el Worker ni en D1 de producción. El candidato 4.6.1 es un borrador de laboratorio; no se instaló para el show.

## Causa comprobada y reparación

El receptor dependía demasiado de invalidaciones WebSocket. Una conexión silenciosa podía conservar apariencia de conexión sin transportar avisos, y los avisos recibidos durante bloqueos podían perder su oportunidad de sincronización. La reparación previa de `guest-star-bridge/src/server.mjs` incorpora heartbeat cada 20 s, detección de silencio a los 45 s, comprobación periódica, reconciliación con D1 a los 60–80 s, retención y drenaje de invalidaciones y liberación del bloqueo en `finally`. La recepción sigue separada de comandos de VirtualDJ.

En el candidato nativo se reprodujo otra espera: abrir una actividad Bridge que ya estaba en marcha ejecutaba `stopCloudRealtime()` y esperaba mantenimiento de YouTube antes de responder a `/api/auth/selection`. Con 641 solicitudes de laboratorio el selector permanecía bloqueado durante minutos. La corrección `d03d8c4` autoriza de nuevo remotamente y reconoce exclusivamente la misma actividad Bridge, hotel, venue, inicio y ciclo; mantiene el receptor activo, sin reemplazar solicitudes ni operar VirtualDJ. Cambios reales de contexto y Player mantienen su serialización. La prueba HTTP con una respuesta YouTube retenida falla en el servidor anterior y pasa con la corrección; 3/3 pruebas nuevas pasan.

**Esta segunda corrección está en código y pruebas, pero no dentro del DMG rc.1 ya construido.** Requiere otro empaquetado y validación nativa antes de distribuirla. El DMG rc.1 conserva el defecto del selector y queda bloqueado.

No hay evidencia suficiente para atribuir el origen al plugin: su código instalado y el de la distribución de octubre coinciden, y el bloqueo confirmado pertenece al receptor/selección del Bridge. La coincidencia temporal de la migración no demuestra causalidad.

## Entorno real y metodología

Se reutilizó la identidad de la cuenta de auditoría en una base aislada, con un hotel, venue y actividad de laboratorio. El registro real de la cuenta quedó intacto. El Worker `guest-star-connectivity-audit-20261027` ejecutó los siete módulos descargados del Worker publicado de producción; D1 aislada `1639c804-1ace-4e28-837c-9dacede2a8d7`, migraciones 1–7. Producción permaneció en versión Worker `8a159f8e-d13a-4d67-aa41-2536b38582b4`.

Los 100 clientes virtuales tuvieron identificadores, sesiones, cookies y WebSockets independientes: 50 con PIN de Kiosko y 50 con enlace Request, bajo una misma salida NAT real, sin falsear IP. Se verificaron 100 hashes de dispositivo en D1. Se utilizaron los endpoints reales, HTTPS, WSS, persistencia remota y Host nativo de macOS. Un proxy local únicamente permitió interrumpir o retrasar el enlace del Host al Worker aislado. Los intervalos de entrega terminan en la primera visibilidad de `/api/state` del Host; no son tiempos de pintado de pantalla. No equivalen a 100 teléfonos físicos en una red de hotel.

## Solicitudes, pérdidas y recuperación

| Ensayo | Confirmadas registradas | D1 | Host verificado | Resultado y límite |
|---|---:|---:|---:|---|
| Corrida 3, lotes 3/10/25/50, concurrencia 100 y 10 min | 283 | 283 | 283 | Durabilidad pasa; al cierre había 0/100 sockets; corrida global falla |
| Corrida 4, interrupción del cliente de prueba | 80 | 86 | 86 al revisar después | El colector se abortó; 6 persistencias carecen de confirmación registrada; no son pérdidas |
| Corrida 6, lotes y fallos, concurrencia 100 y 10 min | 271 | 271 | 271 | Durabilidad pasa; criterio final de sockets falla 99/100 |
| Request desde navegador real | 1 | 1 | 1 | Aproximadamente 7 s, con VirtualDJ abierto |
| Total persistido del laboratorio | — | 641 | 641 observadas en Host | Sin IDs duplicados en D1 |

Las corridas 3 y 6 tienen comprobación individual de ID, tenant, ciclo y posición de cola. Cero solicitudes confirmadas perdidas en esas corridas. Se recibieron muchas más de las tres iniciales. La corrida 6 recuperó 20 solicitudes tras desconexión del Host y una solicitud con invalidación descartada; incluyó 10 con 1700 ms de retraso, actualizaciones concurrentes, 7 reintentos HTTP idempotentes, 109 reconexiones de socket y 32 solicitudes durante 10 minutos. No se ocultan los fallos del transporte ni se declara aprobada toda la corrida.

Un ensayo adicional de recuperación, con timeout de handshake y 30 clientes pasando a segundo plano, sí terminó en **100/100 conectados, 100 sesiones y 100 pong únicos**. Hubo 36 cierres y 2 errores de transporte; 173/272 muestras mostraron 100 conectados. Esto prueba recuperación, no disponibilidad continua de los 100 durante desconexiones deliberadas. Las primeras corridas abortadas por un campo de token incorrecto, preparación sin heartbeat o fallo de handshake también permanecen archivadas localmente.

| Lote, corrida 6 | Media ms | p95 ms | Máxima ms |
|---|---:|---:|---:|
| 3 | 2786 | 2923 | 2923 |
| 10 | 3928.8 | 9224 | 9224 |
| 25 | 7659.64 | 17194 | 21477 |
| 50 | 16805.14 | 19372 | 19372 |
| 100 simultáneas | 19707.1 | 20264 | 20264 |
| 20 con actualizaciones concurrentes | 19575.15 | 28006 | 28006 |
| 20 durante desconexión | 17924.65 | 17926 | 17926 |
| 32 en prueba prolongada | 8928.906 | 27243 | 28640 |

Con retraso inyectado, las 10 solicitudes tardaron 28554 ms; la invalidación perdida se recuperó en 23997 ms. Son latencias elevadas y constituyen una limitación operativa real. La subida de un DMG de 349 MiB también compartió esta conexión; no se atribuye toda la demora a Cloudflare ni se certifica la Wi-Fi física del hotel.

## VirtualDJ y restricciones

Se verificaron plugin instalado, firma, carga real y salida visual con el hotel/actividad de auditoría. Ambos decks estaban vacíos y detenidos, Karaoke tenía 0 elementos y Automix mantenía 33 canciones del usuario. No se reprodujo audio ni se alteró Automix. **No se completó un envío físico a Karaoke ni la autocarga de posición 1; ese recorrido no queda certificado por esta auditoría.** Sus pruebas de contrato/HTTP sí se ejecutaron dentro del grupo crítico.

Al cerrar el ensayo VirtualDJ dejó de responder a Network Control; se observó una instancia con argumento `recover`, video desactivado y decks vacíos. Los comandos de restauración por API agotaron su espera. La instancia abierta para el ensayo fue cerrada con SIGTERM después de que el cierre normal no terminara; no se afirma verificación final por API de la cola. La evidencia visual final conservaba Automix 33 y video sin activar. Debe verificarse el arranque de VirtualDJ antes de un show; este incidente refuerza el bloqueo del candidato. No hubo comandos de carga, reproducción o borrado de canciones.

Request funcionó en navegador. El acceso real a Kiosko con PIN se ejercitó en los clientes; el envío de formulario visual de Kiosko y Attract no quedó validado de extremo a extremo. No se modificaron diseño, branding, audio, stems, Lyrics, Attract ni programación ajena a la falla. Los tests nuevos verifican que reentrar preserve completadas y no genere comandos de cola.

## Cloudflare, límites y errores

En la lectura final de GraphQL del staging: 8645 invocaciones `success`, 665 `clientDisconnected`, 7 `responseStreamDisconnected`; suma `errors: 0` en esas categorías. No se observó un 1102 ni un 503 atribuible al Worker invitado en las evidencias revisadas. Los 503 del proxy eran inyectados. Sí hubo timeouts HTTP reales, cierres 1006 y desconexiones; no se afirma ausencia de errores de conectividad.

La última consulta analítica de producción fue rechazada por `Rate limiter budget depleted` de la API GraphQL (no del endpoint de solicitudes). La inspección de facturación/cuotas de cuenta devolvió 403; por ello no se certifican los límites contratados reales. Las cuantiles CPU de la respuesta se conservan sin convertir unidades no verificadas. Se mantienen las limitaciones documentadas de [Workers](https://developers.cloudflare.com/workers/platform/limits/) y [D1](https://developers.cloudflare.com/d1/platform/limits/), sin usarlas como prueba del plan de esta cuenta. El backend publicado devuelve hasta 1000 solicitudes activas sin paginación: 641 no demuestra comportamiento ilimitado.

## Regresión, compilación y procedencia

| Verificación | Resultado |
|---|---|
| Grupo crítico con nueva corrección | 43/43 pasan, 0 omitidas |
| Suite completa antes de nueva corrección | 524: 485 pasan, 39 fallan |
| Suite completa después | 527: 488 pasan, 39 fallan, 0 omitidas |
| Comparación de fallos | Mismos 38 nombres de fallos de nivel superior; 39 contando subprueba; ningún fallo nuevo |
| Compilación nativa limpia | arm64, SDK ONNX y modelo preservados |
| DMG rc.1 | Montado y verificado con hdiutil; firma ad hoc deep/strict válida |
| Procedencia del DMG | 112 archivos runtime coinciden con Git `929f5bbcb2509d3044aca8936591ca7cb1a3c107` |
| Firma/notarización | Ad hoc; sin Developer ID ni notarización |
| Compatibilidad empaquetada | arm64, macOS mínimo 15.5 por biblioteca incluida; no certificación Intel |

Los fallos previos incluyen contratos estructurales de UI, Player, Lyrics y empaquetado. Conservar los mismos fallos no equivale a una suite aprobada. No se cambian esas funciones para hacer pasar la auditoría de conectividad.

La versión local usa fuentes de octubre: 112 archivos de runtime coincidían con el origen canónico; 63 difieren del tag nominal `v4.6` de septiembre y 101 de `main`. El último DMG público por fecha es `v4.6-branding-20261013`, aunque `/releases/latest` señalaba `v4.6`. El tag de octubre apunta al antiguo `main` (`70ac66ac...`), cuyas fuentes no representan ese DMG: hay un defecto previo de procedencia. Las capturas iniciales de esta rama registran fuentes ya existentes; no deben confundirse con cambios nuevos de UI de esta reparación.

## Entrega y despliegue

- [Release de laboratorio, borrador autenticado](https://github.com/garykeyz/Guest-Star-Experience/releases/tag/untagged-791aeabb4d3de399b5b1).
- [DMG rc.1, acceso autenticado](https://github.com/garykeyz/Guest-Star-Experience/releases/download/untagged-791aeabb4d3de399b5b1/Guest-Star-Experience-4.6.1-rc.1-arm64.dmg).
- [Código de correcciones](https://github.com/garykeyz/Guest-Star-Experience/tree/codex/connectivity-p0-20261027).
- Commit empaquetado: `929f5bbcb2509d3044aca8936591ca7cb1a3c107`; corrección posterior del selector: `d03d8c4`.
- Versión DMG 4.6.1, build 461; tamaño 365566284 bytes.
- SHA-256: `88b6c7ac699472248d0d5736334f4e23a6a598bdc5aa8b3430528df16dc31283`.

GitHub calculó el mismo SHA-256 del asset completo. Una lectura autorizada HTTP 206 de los primeros 65536 bytes coincide con el archivo local; no se descargó otra vez el DMG completo y no se afirma su hash tras una descarga completa. No hay autoupdate de red identificado en las fuentes: el supervisor actualiza el runtime local desde la app instalada. No se cambió distribución estable ni se fusionó la rama.

**Bloqueos para la versión final solicitada:** 39 fallos de regresión, nueva reparación del selector aún sin reempaquetar/validar en nativo, cierres de sockets y latencias elevadas bajo carga, incidente de recuperación VirtualDJ y recorrido físico Karaoke/autocarga pendiente. El objetivo global no se declara completado ni certificado. Se entrega el trabajo ejecutado y verificable conservando la versión operativa para el show.

## Cierre y rollback

Se cerró la admisión de solicitudes de la actividad aislada y se detuvieron proxy y tail de pruebas al finalizar, conservando D1 e históricos de laboratorio. Se restauró el runtime original y su enlace a los datos reales. La instalación original no fue reemplazada. La actividad real sigue detenida y sus tres IDs/revisiones originales coinciden. La copia completa de la app anterior y runtime del ensayo se conservaron localmente en `release-audit-20261027/production-rollback`. Los releases públicos anteriores siguen disponibles. Para cualquier futura promoción: guardar app/runtime/config, cerrar Guest Star, instalar candidato verificado y comprobar versión/tenant/IDs; si falla, cerrar, restaurar la copia original y abrir `/Applications/Guest Star Experience.app`, sin borrar D1 ni datos históricos.

Las evidencias adjuntas contienen únicamente IDs y registros del laboratorio o resúmenes sanitizados. Credenciales, tokens, logs con cabeceras y datos reales de huéspedes permanecen privados.
