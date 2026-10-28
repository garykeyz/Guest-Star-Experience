# Guest Star Karaoke — operación local

La app Guest Star Experience contiene el endpoint de pantalla. Abrirla, seleccionar la actividad y elegir **Bridge con VirtualDJ**. Seleccionar el modo no inicia la actividad. Mantener abierta la ventana Bridge para conservar la observación de la cola real existente.

En VirtualDJ: activar vídeo, elegir Guest Star Karaoke como Video FX y activar el efecto. En Settings → Interface → Karaoke overlay está seleccionada la skin propia Guest Star Karaoke. La salida usa la actividad, Theme y logos que ya estén configurados en Guest Star. No hay un Theme adicional.

El plugin consume `http://127.0.0.1:8787/api/vdj/state`. Su opción Port debe ser **8787**. Este puerto es distinto de **8768**, utilizado por el Network Control existente para Bridge → VDJ. No intercambiarlos.

Opciones en la configuración oficial del efecto:

| Control | Valores |
|---|---|
| Show QR / PIN / logo / Next Singer / artist | On / Off |
| Show guest message | Off por defecto; visible en FULL |
| Extended metadata | Off por defecto; añade equipo y estado en FULL |
| Next singers | 1 / 2 / 3 / 5, cuatro posiciones del slider |
| Mode | MINIMAL / STANDARD / FULL, tres posiciones |
| QR mode | ALWAYS / BETWEEN SONGS / HIDE DURING SONG |
| Port | 8787; sólo localhost |

Durante una canción, los modos muestran una franja superior compacta. Con QR ALWAYS se añade un QR pequeño arriba a la derecha; por defecto se oculta mientras se canta. El área central e inferior queda libre. Un karaoke con letras en la parte superior puede requerir desactivar el efecto; el plugin no analiza ni detecta letras incrustadas en un vídeo.

Al finalizar, el QR y PIN dejan de dibujarse. Si se pierde el servicio local, el overlay reemplaza la metadata por “esperando conexión local” y vuelve al estado real al reconectar. Player interno produce una textura transparente: no toma el control de Star Screen.

Sin el plugin activo, la skin es un fallback de metadata nativa de VirtualDJ entre canciones; no puede mostrar branding y QR dinámicos por sí sola.

Para compilar en otra Mac Apple Silicon: descargar el SDK oficial de Atomix, disponer de Xcode Command Line Tools y ejecutar `bash build.sh /ruta/a/headers/SDK`. El bundle generado se copia a la carpeta VideoEffect soportada de esa instalación. El SDK, VirtualDJ, licencias, logos de hoteles y música no forman parte de un paquete redistribuible Guest Star.

Para revertir usar el backup y su RESTAURAR.md. Para desactivar solamente el overlay, apagar Guest Star Karaoke en Video FX y volver a seleccionar el karaoke overlay anterior desde Settings. Se conservaron las skins originales.
