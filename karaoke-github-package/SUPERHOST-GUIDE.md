# Guía del Superhost

El Superhost administra toda la instalación sin entregar su cuenta de Google a
los hoteles ni a los DJs.

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

1. Entra en `/host` como Superhost.
2. En **Hotels and Independent Sheets**, escribe nombre y zona horaria IANA.
3. Pulsa **Create Hotel + Sheet**.
4. Guarda los tres enlaces mostrados: página pública, hoja del hotel y QR PNG.

La hoja se crea en la carpeta `Guest Star Experience - Hotel Data` de Drive. El
enlace público es permanente aunque cambie la actividad activa.

Si aparece un error de `DriveApp.getFileById`, no vuelvas a pulsar **Create
Hotel + Sheet** hasta autorizar Drive y actualizar la implementación web
existente. La comprobación se realiza antes de crear archivos para evitar hojas
huérfanas.

## Crear y asignar un Host

1. En **Host Users**, crea nombre, usuario y correo opcional.
2. Copia la contraseña temporal; después de salir del aviso no puede recuperarse.
3. En **Assignments**, elige usuario, hotel y perfil:
   - `Activity Operator`: operación normal del evento.
   - `Hotel Manager`: administración completa dentro del hotel.
   - `Read Only`: consulta sin cambios.
4. Entrega al operador `/host`, usuario y contraseña temporal.

Crear o asignar un usuario nunca crea otra hoja de cálculo.

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
