# Guest Star Bridge 3.0.0

Puente local para Mac entre:

- la página **Guest Star Experience** y su Google Sheet;
- tus carpetas locales de karaoke;
- las búsquedas de versiones **Karaoke / Lyrics** en YouTube;
- la rotación **Karaoke** de VirtualDJ.

Los botones **Abrir solicitudes**, **Cerrar solicitudes** y **Reiniciar
actividad** están sincronizados con el control HOST de la web y con el menú de
Google Sheets. Un cambio hecho en cualquiera de los tres lugares aparece en el
Bridge normalmente en unos dos segundos. Al volver a enfocar la aplicación,
también se solicita una sincronización inmediata.

La versión 3.0.0 también:

- tolera pequeñas diferencias de artista entre la biblioteca y VirtualDJ;
- muestra tiempo transcurrido, tiempo confirmado, faltante o exceso;
- permite marcar cada canción como **Ya cantó** o **Saltado**;
- edita duración, transición y apertura de solicitudes en Sheets desde la app;
- sugiere temas hit para el EMCEE o una persona elegida al azar cuando la cola
  está vacía.

## Uso rápido en Mac

### Instalador para Apple Silicon

Si usas un Mac M1, M2, M3 o M4, abre
`Guest-Star-Bridge-M1-v3.0.0.dmg`, arrastra **Guest Star Bridge.app** a
**Aplicaciones** y ábrela. El Bridge incluye Node.js ARM64, se ejecuta en
segundo plano y muestra el panel dentro de una ventana propia de macOS, sin
abrir Safari, Chrome ni pestañas del navegador.

Al cerrar esa ventana o salir con `Command + Q`, también se detiene el servidor
local que inició la aplicación.

Como esta compilación no tiene un certificado comercial de Apple, la primera
vez usa clic derecho sobre la aplicación → **Abrir** → **Abrir**. Esto solo se
hace una vez.

La app guarda su configuración en
`Library/Application Support/Guest Star Bridge` y puede importar automáticamente
la configuración de una instalación anterior ubicada en Downloads, Desktop o
Documents.

### Carpeta tradicional

1. Actualiza primero el `Code.gs` del proyecto y publica una **Nueva versión** de Google Apps Script.
2. En VirtualDJ instala **Network Control** desde:
   `Settings → Extensions → Effects → Other → Network Control`.
3. Activa Network Control en el panel Master/Auto-Start. Usa el puerto `80` o coloca el mismo puerto en el Bridge.
4. Haz doble clic en `INICIAR-GUEST-STAR.command`.
5. Si macOS lo bloquea la primera vez: clic derecho → **Abrir**.
6. En **Configuración**:
   - elige una o varias carpetas de karaoke;
   - coloca el PIN privado del host;
   - confirma el puerto de VirtualDJ;
   - prueba la hoja y VirtualDJ.

## Actualizar desde Bridge 2.8 o 2.9

1. Cierra la ventana anterior del Bridge.
2. Conserva tu archivo `data/config.json` si quieres mantener las carpetas, el
   PIN y el puerto ya configurados.
3. Sustituye los archivos por los de Bridge 3.0.0 y vuelve a abrir
   `INICIAR-GUEST-STAR.command`.

Al abrir la versión 3.0.0, la configuración anterior se conserva. Las carpetas y
el PIN se recuerdan por defecto, pero cada opción puede desactivarse por separado
desde **Configuración**.

La cola local se limpia automáticamente cuando la actividad se reinicia desde
la web, la hoja o este panel.

Cada solicitud muestra en el Bridge el mismo enlace guardado en la columna
**Fuente** de Google Sheets, con botones para copiarlo o abrirlo.

El Bridge comprueba en cada sincronización la cola Karaoke que realmente tiene
VirtualDJ. Si una canción que había sido enviada ya no aparece allí, su tarjeta
pregunta si quieres **volver a agregarla al final** o **dejarla fuera**. Al
reagregarla, ocupa la última posición de la rotación.

Las canciones enviadas se muestran según su posición real en VirtualDJ. Las
solicitudes que todavía no están en la cola permanecen organizadas por fecha y
hora de llegada.

Una canción también puede moverse nuevamente al final de la rotación o retirarse
de VirtualDJ directamente desde su tarjeta en el Bridge.

Si una solicitud que fue agregada por el Bridge desaparece de la hoja, el
Bridge la retira visualmente y busca esa misma combinación de archivo y cantante
en la cola Karaoke de VirtualDJ para eliminar únicamente esa entrada. El
seguimiento queda guardado localmente para continuar funcionando después de
reiniciar el Bridge.

No hace falta instalar paquetes con `npm`: el Bridge utiliza únicamente Node.js.

## Cuando no está la canción

Con la YouTube Data API configurada en Google Apps Script, el Bridge busca
automáticamente y muestra hasta **seis enlaces directos**:

1. Primero intenta encontrar karaoke con letra visible. Solo acepta títulos con
   señales de lyrics/letra o canales de karaoke reconocidos.
2. Si no hay suficientes versiones karaoke confiables, completa las opciones
   con videos lyrics con voces y letra en pantalla.

Ningún enlace se copia automáticamente. Cada resultado tiene su propio botón
**Copiar este enlace**, para que el host elija exactamente cuál quiere usar.

El huésped debe elegir el idioma de la canción antes de que aparezca el
formulario. Ese dato llega a Google Sheets y se muestra en la tarjeta del
Bridge. Las opciones válidas con letras se ordenan según la prioridad de canales
definida para inglés, español, francés, portugués, alemán, italiano o ruso.
**Español** incorpora la lista ampliada de Latinoamérica. En inglés, los tres
primeros canales son Sing King, Stingray Karaoke y KaraFun Karaoke; también se
reconocen Zoom Karaoke, Atomic Karaoke, Karaoke Sesh, Leo Ponce y Musisi
Karaoke.

La descarga queda bajo el control del usuario. El Bridge vigila las carpetas
configuradas en tiempo real y la interfaz recibe cada cambio sin esperar una
recarga. El escaneo cada 10 segundos continúa como respaldo. Cuando aparece una
coincidencia exacta, la agrega automáticamente a la cola Karaoke de VirtualDJ
con el nombre del cantante.

Si una pista que ya estaba localizada se mueve o se borra, el Bridge detecta
que dejó de estar disponible, descarta los resultados anteriores y vuelve a
buscar hasta seis opciones Karaoke/Lyrics. Los nuevos enlaces aparecen en la
misma tarjeta para elegir cuál copiar, incluso si la solicitud todavía figura
en la rotación de VirtualDJ.

Sin una clave válida de YouTube Data API no se inventa un enlace ni se abre una
página de resultados: el panel avisa que todavía no encontró un video confiable.

## Seguridad

- El servidor escucha solamente en `127.0.0.1`: no queda expuesto en internet.
- El PIN y la contraseña de Network Control se guardan únicamente en
  `data/config.json` en el Mac cuando sus opciones de recordar están activadas.
- El comando enviado a VirtualDJ utiliza su plugin Network Control:
  `/query` para probar la conexión y `/execute` para agregar la pista.

## Pruebas

```bash
npm test
```
