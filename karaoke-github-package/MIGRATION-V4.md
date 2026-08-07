# Migración segura de 3.0.7 a 4.0.0

La migración conserva la instalación anterior y crea una copia antes de separar
la información por hotel.

## Preparación

1. Descarga o conserva el release 3.0.7.
2. Confirma que la hoja antigua tenga las solicitudes esperadas.
3. Instala `Code.gs` 4.1.0 en el proyecto de Apps Script existente.
4. Configura `INITIAL_HOTEL_NAME` y `INITIAL_HOTEL_TIMEZONE`.

## Ejecutar la migración

1. Regresa a la hoja, recarga la página y elige **🎤 Karaoke → Set Up or Recover
   Superhost Access** desde la cuenta del Superhost.
2. Autoriza los permisos solicitados.
3. El sistema crea una copia de respaldo de la hoja heredada.
4. Crea las tablas centrales en la hoja maestra.
5. Crea la hoja independiente del primer hotel y copia allí la operación
   heredada sin borrar `Solicitudes` ni `Historial`.
6. Copia el usuario y la contraseña temporal desde la ventana de credenciales.
7. Publica una nueva versión de la implementación existente para conservar `/exec`.

## Verificación

- La propiedad `MASTER_SHEET_ID` apunta a la hoja maestra.
- La tabla `Hotels` contiene `dataSheetId` para cada hotel.
- El primer hotel abre su hoja independiente.
- El enlace permanente `/h/...` muestra solo ese hotel.
- El Bridge 4.0 inicia sesión y permite seleccionar una actividad autorizada.
- No hay hojas nuevas al crear usuarios.

`setupMultiUserV4` es idempotente: puede ejecutarse de nuevo para reparar tablas
o activadores faltantes sin duplicar la migración completada.
