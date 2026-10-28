# Entrega actualizada — Guest Star Experience 4.6.1

Esta entrega sustituye el estado bloqueado de rc.1 del informe inicial. La versión 4.6.1 build 462 contiene la corrección de reentrada Bridge y está instalada y comprobada con la configuración real. El informe inicial se conserva como historial de la investigación, no como estado de esta entrega.

## Paquete y código

- [Release 4.6.1](https://github.com/garykeyz/Guest-Star-Experience/releases/tag/v4.6.1).
- [DMG 4.6.1 arm64](https://github.com/garykeyz/Guest-Star-Experience/releases/download/v4.6.1/Guest-Star-Experience-4.6.1-arm64.dmg).
- [Código empaquetado](https://github.com/garykeyz/Guest-Star-Experience/commit/c8351e7f5c3bee713379f0b182720d519c26025e).
- [PR 49 y validación web actualizada](https://github.com/garykeyz/Guest-Star-Experience/pull/49).

Versión 4.6.1, build 462. Tamaño 367964473 bytes. SHA-256 `f8c57d554d04e0e3d811658656fa58d7ef9a901ecf70ff2494e0817880471b2b`. Bundle `3e3d9436410fd860b037b3d599ce28013edcfc35304eb1a58714b6c85c083c3d`. Código del paquete c8351e7; actualizaciones posteriores del commit 9b3b06a afectan dependencias de construcción web y pruebas, con los mismos árboles src/public/macos del Bridge.

Compilación nativa limpia; DMG montado y verificado con hdiutil; firma ad hoc deep/strict válida; 112 archivos runtime coinciden individualmente con el commit. Arquitectura arm64, macOS mínimo 15.5 por la biblioteca incluida. No tiene notarización ni firma Developer ID; no se certifica Intel. GitHub calculó el mismo SHA-256 del asset completo. El enlace público devuelve el DMG sin autenticación. Se descargaron desde GitHub los 367964473 bytes completos en 16 rangos y su SHA-256 coincide con el original; véase final-full-download-verification.json.

## Reparaciones incluidas y resolución de los 39 fallos

El receptor incorpora heartbeat, recuperación de WebSocket silencioso, reconciliación periódica con D1 y drenaje de invalidaciones retenidas durante operaciones. La selección de la misma actividad Bridge valida de nuevo la autorización, hotel, venue, inicio y ciclo, manteniendo la recepción sin esperar mantenimiento YouTube. La prueba HTTP con mantenimiento detenido reproduce el fallo anterior y pasa con la reparación; la comprobación nativa real devolvió 200 en 1883.5 ms conservando las 881 solicitudes que había en ese momento.

Se corrigió también un ID DOM duplicado: transporte y preferencias de medios tenían ambos `playerMediaStatus`. Preferencias usa ahora `playerMediaPreferencesStatus`; el estado del transporte permanece independiente. No se cambiaron diseño, Attract, reproducción, stems, Lyrics, branding ni la política manual de inserción en Karaoke.

Los 39 fallos no representaban 39 defectos nuevos del producto. Incluían expectativas de versión 4.5, funciones movidas a módulos, inicialización implícita que ya exige selección explícita, dobles DOM incompletos, formato LRC que ahora conserva tiempos por palabra y contratos antiguos de la composición visual. Las pruebas se actualizaron al comportamiento vigente y a sus dependencias reales, sin omitirlas ni reintroducir inserción automática. Los fixtures D1 ahora preparan explícitamente sus sesiones y la decisión de conservar/vaciar su cola; no se modificó la programación del producto para hacer pasar los tests.

| Validación local final | Resultado |
|---|---|
| Bridge completo | 527/527 pasan, 0 fallos, 0 omitidas |
| Integración HTTP de retiro, reingreso, orden, enlaces y estados | Pasa |
| D1: autenticación, tenants, sesiones, programación, idioma y ráfaga de 200 | Pasa |
| TypeScript | Pasa |
| Build Next de producción | Pasa |
| HTTP de producción y límites de seguridad | Pasa, 0 llamadas a Apps Script |
| Build OpenNext/Cloudflare | Pasa; no se desplegó en producción |
| npm audit --audit-level=low | 0 vulnerabilidades |

Las dependencias web se actualizaron sin desplegar el Worker: Next 16.4.3 y paquetes transitivos corregidos, con lockfile reproducible. Las correcciones están respaldadas por los avisos de [Next](https://github.com/advisories/GHSA-673q-mjm6-r5xr) y [Undici](https://github.com/advisories/GHSA-55wc-3pg8-jfw6). La validación local completa no se presenta como una ejecución aprobada de GitHub Actions: Los conflictos de PR 49 con main eran únicamente dos archivos de dependencias; se resolvieron manteniendo el árbol validado idéntico, y GitHub Actions volvió a ejecutarse sobre aa10325 y encontró una dependencia de pbcopy en Linux dentro del fixture de integración (526 pasan, 1 falla, 3 casos específicos de plataforma omitidos). Se adapta ese caso al camino real de Clipboard API del navegador, sin cambiar el runtime. Se actualiza además la automatización nativa obsoleta al compilador ARM64 usado en esta entrega, con dependencias fijadas por SHA-256; el presupuesto de tamaño de Worker se ajusta al framework corregido (3.87 MB raw / 1.15 MB gzip), manteniendo el detector de traducciones incrustadas. Estos tamaños no certifican tiempo de CPU. La nueva ejecución de CI queda enlazada en PR 49. Las ejecuciones anteriores conservan sus fallos históricos. No se fusionó PR 49 ni se forzó despliegue de main.

## Nueva carga remota sobre el paquete final

Se usaron Worker/D1 aislados con los módulos publicados de producción, Host nativo y 100 clientes virtuales independientes bajo la misma salida NAT: 50 PIN Kiosko y 50 Request. No son 100 teléfonos físicos ni una certificación de Wi-Fi del hotel.

**283 solicitudes confirmadas, 283 persistidas individualmente en D1 y 283 visibles en Host; 0 pérdidas y 0 IDs duplicados. Al cierre quedaron 100/100 WebSockets conectados y 100 sesiones distintas.** La corrida final global pasó, a diferencia de las corridas fallidas conservadas en el informe inicial. Hubo 44 solicitudes durante 10 minutos de prueba prolongada, además de lotes 3/10/25/50 y 100 concurrentes, reintentos idempotentes, desconexión, aviso descartado, latencia y actualizaciones simultáneas. Se recuperaron 20/20 solicitudes tras la desconexión del Host.

La verificación final comprueba cada ID, hotel, venue, actividad, ciclo y orden de llegada por timestamp mostrado por Host. Hay 253 valores físicos queue_position=0 después de actualizar metadatos; no representan IDs duplicados. La clave efectiva de D1 sigue siendo única para las 283 filas. El Host conserva posiciones administrativas y ordena por timestamp; no se equipara sin más el índice físico de VirtualDJ con el orden de llegada de solicitudes.

| Lote | Cantidad | Media ms | p95 ms | Máxima ms |
| batch3 | 3 | 22811.00 | 65238 | 65238 |
| batch10 | 10 | 2433.80 | 3564 | 3564 |
| batch25 | 25 | 4701.08 | 5621 | 5621 |
| batch50 | 50 | 5002.36 | 5889 | 5889 |
| concurrent100 | 100 | 3988.99 | 3991 | 3991 |
| offline | 20 | 18764.05 | 18765 | 18765 |
| lost-invalidation | 1 | 22805.00 | 22805 | 22805 |
| latency1700 | 10 | 36620.00 | 36620 | 36620 |
| during-updates | 20 | 2908.80 | 3555 | 3555 |
| soak | 44 | 3714.75 | 6810 | 13668 |

Media general 6520.23 ms, p95 18764 ms, máximo 65238 ms. La demora máxima ocurrió durante el envío HTTP inicial; no se oculta. El lote de 50 tuvo p95 5889 ms y las 100 concurrentes p95 3991 ms. Los tiempos terminan en primera visibilidad de la API del Host, no en pintura de pantalla. Continúan siendo posibles retrasos de red y reconciliación; no se promete latencia constante ni disponibilidad sin interrupciones.

## VirtualDJ físico

Pasó el recorrido de una solicitud real del laboratorio a la cola Karaoke física y su autocarga en deck 1 usando un WAV silencioso de prueba. **No se reprodujo audio.** Se retiró solamente esa solicitud, se descargó su archivo del deck y se verificaron Karaoke vacío, ambos decks vacíos/detenidos y Automix con las mismas 33 canciones. La evidencia conserva las consultas físicas antes/después y el resultado de la operación. La nueva corrida también recibió solicitudes con VirtualDJ desconectado. No se sustituyó el plugin.

## Instalación y datos reales

Se instaló desde el DMG verificado en `/Applications/Guest Star Experience.app`, se comprobó versión/fingerprint y que el runtime activo apunta a los datos reales y a `request.gstarxp.com`, no al laboratorio. La selección de producción evolucionó durante la auditoría: al cerrar hay 25 solicitudes de la configuración real actual. No se fuerza la selección histórica del preflight. Una consulta de solo lectura confirmó que las tres solicitudes originales siguen en D1. No se borraron registros ni se desplegó el Worker de producción.

Se conservó la app anterior completa en `release-audit-20261027/production-rollback/app-before-4.6.1-install` y respaldos de runtime. El laboratorio quedó con solicitudes cerradas y procesos de carga/proxy detenidos, manteniendo su historial. Para rollback, cerrar Guest Star si no reproduce, restaurar la app anterior, validar firma y abrirla conservando el directorio de datos; no borrar ni restaurar D1 a un estado anterior. La app actualizada queda abierta para revisión.
