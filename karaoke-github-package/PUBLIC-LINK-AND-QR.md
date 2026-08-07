# Enlace público y QR por hotel

Al crear un hotel, el sistema genera una ruta permanente:

`https://request.gstarxp.com/h/<slug>-<código-aleatorio>`

El huésped no puede elegir hotel, sede ni actividad. El servidor resuelve el
hotel desde el código, muestra solamente su identidad y dirige la solicitud a
su hoja independiente.

## Uso

1. El Superhost crea el hotel.
2. Abre **Public Page** para probar el enlace.
3. Descarga **QR PNG** y colócalo en material del hotel.
4. El Host puede volver a copiar el enlace desde el panel de la actividad.

El enlace se mantiene al cambiar de actividad. Solo la actividad pública activa
del hotel recibe solicitudes. Desactivar el hotel invalida su acceso público.

El QR se genera como archivo en Drive. Si una política de Google Workspace
impide compartir ese archivo, el enlace público sigue funcionando y el
Superhost puede descargar el PNG autenticado para distribuirlo manualmente.
