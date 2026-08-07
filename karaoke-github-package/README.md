# Guest Star Experience 4.0.1

Sistema multi-hotel para solicitudes de karaoke, operación Host, Bridge local y
sincronización con VirtualDJ.

## Modelo 4.0

El **Superhost** administra el sistema desde su propia cuenta de Google:

- un Apps Script central;
- una hoja maestra central;
- una hoja independiente por hotel, creada automáticamente al registrar el
  hotel;
- usuarios y permisos dentro del registro maestro, sin crear hojas por usuario;
- enlace público permanente y QR por hotel;
- panel seguro `/host` para Superhost y Hosts, sin compartir Google.

Al crear un hotel desde el panel se crean en una sola operación: hoja del hotel,
sede principal, actividad Guest Star Karaoke, identidad inicial, enlace, QR y
asignación del Superhost.

## Primera configuración

Lee [MULTIUSER-SETUP.md](MULTIUSER-SETUP.md). El resumen es:

1. El Superhost crea una hoja maestra en Google Sheets.
2. Abre su Apps Script ligado y pega `google-apps-script/Code.gs`.
3. Ejecuta `setupMultiUserV4` y guarda la contraseña temporal mostrada una vez.
4. Implementa como aplicación web, ejecutando como el Superhost y con acceso
   para cualquier persona.
5. Configura la URL `/exec` como `KARAOKE_APPS_SCRIPT_URL` del sitio.
6. Entra en `/host`, cambia la contraseña y crea hoteles/usuarios.

La autorización inicial de Google no puede automatizarse sin consentimiento del
propietario. Después de ese único paso, hoteles, hojas, sedes, actividades,
enlaces y QR sí se crean desde el panel.

## Despliegue web

- Root directory: `karaoke-github-package`
- Build: `npx opennextjs-cloudflare build`
- Deploy: `npx wrangler deploy`
- Variable requerida: `KARAOKE_APPS_SCRIPT_URL=https://script.google.com/.../exec`

El mismo despliegue puede servir `request.gstarxp.com` y el dominio Host. La
página pública usa `/h/<hotel>` y el panel seguro usa `/host`.

## Bridge Universal para Mac

`guest-star-bridge` conecta la actividad autorizada con:

- carpetas locales de karaoke;
- cola Karaoke real de VirtualDJ mediante Network Control;
- búsqueda de hasta seis versiones Karaoke/Lyrics respetando estrictamente el
  idioma seleccionado;
- comandos remotos del panel Host y estado del dispositivo.

La app incluye motores Intel `x86_64` y Apple Silicon `arm64` (M1–M5), usa
macOS Keychain para secretos y no requiere Node, npm ni Terminal en la Mac del
operador.

## Funciones principales

- selector de idioma obligatorio para cada canción;
- un enlace priorizado en Sheets y seis opciones para el Host;
- orden real de llegada, cola VDJ, acumulados, turno estimado y hora final;
- reloj por segundo y duración exacta más transición;
- dedicatorias visibles;
- deshacer Completed/Skipped con restauración de posición;
- prevención de falsos “falta local” y duplicados durante la sincronización;
- horarios y recurrencia por zona horaria;
- estado público opcional, cuenta regresiva, siguiente actividad y calendario;
- identidad por hotel, reseñas opcionales y recordatorios solo con consentimiento;
- sesiones, dispositivos, permisos por tenant y registro de auditoría.

## Documentación

- [Guía del Superhost](SUPERHOST-GUIDE.md)
- [Guía del Host](HOST-GUIDE.md)
- [Migración 4.0](MIGRATION-V4.md)
- [Seguridad](SECURITY.md)
- [Enlace público y QR](PUBLIC-LINK-AND-QR.md)
- [Horarios](ACTIVITY-SCHEDULING.md)
- [Reseñas y experiencia](REVIEWS-AND-GUEST-EXPERIENCE.md)
- [VirtualDJ](VIRTUALDJ-SYNC.md)
- [Búsqueda por idioma](LANGUAGE-AWARE-SEARCH.md)
- [Reconciliación de cola](QUEUE-RECONCILIATION.md)

## Pruebas

```bash
cd guest-star-bridge
npm test
```

Para la web:

```bash
npm ci
npm run build
```
