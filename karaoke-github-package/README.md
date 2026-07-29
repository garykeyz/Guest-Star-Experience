# Guest Star Experience — Karaoke Host

## Instalar en GitHub
Sube el contenido de esta carpeta dentro de `karaoke-github-package`, reemplazando los archivos existentes.

Cloudflare:
- Root directory: `karaoke-github-package`
- Build command: `npx opennextjs-cloudflare build`
- Deploy command: `npx wrangler deploy`

## Google Apps Script
1. Abre la hoja y entra a Extensiones → Apps Script.
2. Reemplaza `Code.gs` por `google-apps-script/Code.gs`.
3. Ejecuta `setup`.
   Si el proyecto es independiente, la confirmación aparece en el Registro de ejecución
   en vez de una ventana emergente.
4. Ejecuta `configurarCredenciales`.
5. Implementar → Administrar implementaciones → Editar.
6. Selecciona **Nueva versión**, ejecutar como tú y acceso para **Cualquier persona**.
7. Confirma que la URL `/exec` continúe siendo la misma.

El menú **🎤 Karaoke** permitirá abrir, cerrar y reiniciar desde la hoja. El botón **HOST** de la página utiliza el mismo PIN.

Esta versión guarda los tiempos como duraciones reales, repara automáticamente
los contadores que Google haya convertido en fechas de 1899 y mantiene un estado
compartido para **abrir, cerrar y reiniciar** desde la web, Google Sheets o el
Bridge local.

## Guest Star Bridge 3.0.0 para Mac

La carpeta `guest-star-bridge` conecta las solicitudes de esta misma hoja con:

- las canciones guardadas en el disco local;
- hasta seis opciones directas de YouTube cuando falta una canción, priorizando
  karaoke con letras y usando lyrics con voces como respaldo;
- la rotación Karaoke de VirtualDJ con el nombre del cantante.

Después de actualizar `Code.gs` y publicar una **Nueva versión**, abre
`guest-star-bridge/INICIAR-GUEST-STAR.command`. La guía completa está dentro de
`guest-star-bridge/README.md`.

El Bridge deja que el host elija qué enlace copiar y vigila las carpetas en
tiempo real. Cuando un archivo aparece, se mueve o se borra, la interfaz se
actualiza al momento. Si una pista desaparece, el Bridge vuelve a buscar hasta
seis opciones de YouTube para que el host elija cuál copiar. El escaneo cada
10 segundos permanece como respaldo.

La versión 3.0.0 exige que el huésped elija el idioma de la canción antes de
mostrar el formulario. El idioma se guarda en Sheets, aparece en la tarjeta del
Bridge y determina el orden de canales usado para las seis opciones de YouTube.
**Español** usa la lista ampliada de Latinoamérica.

La versión 3.0.0 verifica la cola Karaoke real de VirtualDJ en cada
sincronización. Si una canción enviada ya no está en la cola, pregunta si debe
volver a colocarla al final o dejarla fuera. La interfaz refleja el orden real
de la rotación, mientras las solicitudes todavía no enviadas conservan su orden
de llegada. Las solicitudes nuevas de Google Sheets se consultan cada dos
segundos y también al volver a enfocar la aplicación.

Esta versión añade un reloj continuo de la actividad, la suma del tiempo ya
cantado y realmente en cola, el faltante o exceso frente a la duración
configurada y los estados **Ya cantó** y **Saltado**. La duración, transición y
apertura de solicitudes se pueden editar desde el Bridge. Si la cola queda
vacía, muestra temas hit para el EMCEE o para elegir un cantante al azar.

Para Mac M1/M2/M3/M4 también se incluye una compilación instalable en formato
DMG. La aplicación trae su propio Node.js ARM64, inicia el servidor en segundo
plano sin mostrar Terminal y presenta el panel dentro de su propia ventana de
macOS, sin abrir una pestaña del navegador.
