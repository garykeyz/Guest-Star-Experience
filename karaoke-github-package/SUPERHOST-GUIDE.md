# Guía del Superhost

El Superhost administra toda la instalación sin entregar su cuenta de Google a
los hoteles ni a los DJs.

En 4.1.0, al iniciar sesión como Superhost en **Guest Star Bridge**, el panel de
administración se abre dentro de la misma app. Usa **Español / English** para
cambiar el idioma y **Evento en vivo** para volver a la operación de karaoke.

## Responsabilidades

- Mantener el Apps Script central y la hoja maestra en su cuenta.
- Crear, activar y desactivar hoteles.
- Crear sedes y actividades.
- Crear usuarios y asignar permisos.
- Consultar dispositivos y revocarlos cuando una Mac deja de estar autorizada.
- Configurar identidad, mensajes, módulos públicos y destinos de reseñas.
- Revisar el registro de auditoría.

## Crear un hotel

Antes del primer hotel, ejecuta `authorizeGuestStarV4` desde Apps Script y
aprueba todos los permisos solicitados, incluido Google Drive.

1. Abre Bridge e inicia sesión como Superhost.
2. En **Hoteles**, escribe nombre y zona horaria IANA.
3. Pulsa **Crear hotel**.
4. Copia el enlace permanente o muestra/descarga el QR generado localmente.

La hoja se crea en la carpeta `Guest Star Experience - Hotel Data` de Drive. El
enlace público es permanente aunque cambie la actividad activa.

Si aparece un error de `DriveApp.getFileById`, no vuelvas a pulsar **Create
Hotel + Sheet** hasta autorizar Drive y actualizar la implementación web
existente. La comprobación se realiza antes de crear archivos para evitar hojas
huérfanas.

## Crear y asignar un Host

1. En **Hosts y permisos**, crea nombre, usuario y correo opcional.
2. Copia la contraseña temporal; después de salir del aviso no puede recuperarse.
3. En **Assignments**, elige usuario, hotel y perfil:
   - `Activity Operator`: operación normal del evento.
   - `Hotel Manager`: administración completa dentro del hotel.
   - `Read Only`: consulta sin cambios.
4. Entrega al operador el instalador de Bridge, su usuario y la contraseña temporal.

Crear o asignar un usuario nunca crea otra hoja de cálculo.

## Favoritos y eliminación recuperable

- En **Favoritos**, elige el hotel y agrega o edita canción, artista e idioma.
  La lista se conserva al cerrar Bridge y alimenta el botón aleatorio del hotel.
- Para eliminar un hotel, escribe exactamente su nombre. El enlace público se
  cierra y sus asignaciones y agenda quedan suspendidas, pero los datos no se
  borran. **Restaurar hotel** reactiva únicamente lo suspendido por esa acción.

## Seguridad operativa

- Desactiva un usuario cuando termine su relación laboral; se revocan sesiones y
  dispositivos.
- Si nunca recibiste la cuenta temporal o pierdes la contraseña principal, usa
  en la hoja maestra **🎤 Karaoke → Set Up or Recover Superhost Access**. La
  ventana permite copiar por separado el usuario y la contraseña; si la cuenta
  ya existía, el sistema revoca las sesiones y dispositivos anteriores.
- Revoca una Mac perdida desde **Bridge Devices**.
- No envíes la URL `/exec`, tokens ni contraseñas por canales públicos.
- Mantén al menos un Superhost activo; el sistema impide desactivar el último.
- Usa el registro de auditoría para confirmar quién cambió cada elemento.
