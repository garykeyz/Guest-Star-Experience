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
5. Ejecuta `setupMultiUserV4` y autoriza acceso a Sheets, Drive, correo y
   activadores. Esta autorización la realiza únicamente el Superhost.
6. Copia inmediatamente la contraseña temporal mostrada por el resultado de la
   ejecución. Se muestra una sola vez.
7. Ve a **Implementar → Nueva implementación → Aplicación web**.
8. Configura **Ejecutar como: Yo** y acceso para **Cualquier persona**.
9. Implementa y copia la URL terminada en `/exec`.
10. Configura esa URL como `KARAOKE_APPS_SCRIPT_URL` en el despliegue web.
11. Abre `/host`, inicia sesión y cambia la contraseña temporal.

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
