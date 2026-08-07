# Configuración multiusuario 4.0

Guest Star 4.0 usa un solo propietario técnico: el **Superhost**. El Apps Script,
la hoja maestra y las hojas de cada hotel quedan en la cuenta de Google del
Superhost. Los hosts y DJs no necesitan acceso a esa cuenta.

## Arquitectura

- Un proyecto de Apps Script central.
- Una hoja maestra con usuarios, hoteles, sedes, actividades, permisos,
  dispositivos y auditoría.
- Una hoja de operación independiente por hotel, creada automáticamente en
  Drive al registrar el hotel.
- Cero hojas por usuario. Crear un usuario solo agrega un registro y sus
  asignaciones.
- Un enlace público permanente y un QR por hotel.

## Primera instalación, una sola vez

1. En la cuenta Google del Superhost, crea una hoja vacía para usarla como
   registro maestro.
2. Abre **Extensiones → Apps Script** desde esa hoja.
3. Reemplaza `Code.gs` con `google-apps-script/Code.gs` de esta versión.
4. En **Configuración del proyecto → Propiedades de secuencia de comandos**,
   agrega, si corresponde:
   - `SUPERHOST_EMAIL`: correo del propietario.
   - `SUPERHOST_USERNAME`: usuario inicial; por defecto `superhost`.
   - `INITIAL_HOTEL_NAME`: nombre del primer hotel.
   - `INITIAL_HOTEL_TIMEZONE`: por ejemplo `America/Santo_Domingo`.
   - `PUBLIC_BASE_URL`: por ejemplo `https://request.gstarxp.com`.
   - `HOST_BASE_URL`: dominio del panel seguro, si es diferente.
5. Guarda el proyecto, regresa a la hoja y recarga la página para que aparezca
   el menú **🎤 Karaoke**.
6. Elige **Authorize Required Google Access** y aprueba **todos** los permisos,
   incluido Google Drive. Google permite aprobar permisos por separado; si
   Drive queda sin marcar, Guest Star no podrá crear la hoja independiente de
   cada hotel.
7. Elige **Set Up or Recover Superhost Access**. Esta autorización y la
   configuración inicial las realiza únicamente el Superhost.
8. El sistema crea la cuenta inicial y abre una ventana con botones para copiar
   el usuario y la contraseña temporal. Copia ambos antes de cerrarla; la clave
   se muestra una sola vez y solamente se guarda su hash seguro.
9. Ve a **Implementar → Nueva implementación → Aplicación web**.
10. Configura **Ejecutar como: Yo** y acceso para **Cualquier persona**.
11. Implementa y copia la URL terminada en `/exec`.
12. Configura esa URL como `KARAOKE_APPS_SCRIPT_URL` en el despliegue web.
13. Abre `/host`, inicia sesión y cambia la contraseña temporal.

Si nunca viste la cuenta temporal o cerraste la ventana sin copiarla, vuelve a
la hoja maestra y usa **🎤 Karaoke → Set Up or Recover Superhost Access**. Si la
instalación ya existía, se creará otra contraseña temporal y se revocarán las
sesiones y Macs previamente autorizadas para esa cuenta.

## Crear hoteles y usuarios

1. En `/host`, abre **Hotels and Independent Sheets**.
2. Escribe el nombre y la zona horaria.
3. Pulsa **Create Hotel + Sheet**.
4. El sistema crea automáticamente la hoja del hotel, sede principal, actividad
   inicial, identidad básica, enlace público, QR y asignación del Superhost.
5. Crea el usuario Host en **Host Users**. Esto no crea ningún archivo Google.
6. Entrega su contraseña temporal una sola vez.
7. Asigna el usuario al hotel y elige el perfil de permisos.

No compartas la hoja maestra, las hojas de hotel ni la cuenta Google con el
operador. El operador utiliza `/host` y el Bridge con sus propias credenciales.

Si aparece `DriveApp.getFileById` al crear un hotel, vuelve a Apps Script,
ejecuta `authorizeGuestStarV4`, aprueba todos los permisos y actualiza la
implementación web existente a una versión nueva. Conserva la misma
implementación para no cambiar la URL `/exec`.
