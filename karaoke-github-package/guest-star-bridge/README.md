# Guest Star Bridge 4.2.0

Aplicación local Universal para Mac que conecta Guest Star con la biblioteca de
karaoke y la cola Karaoke real de VirtualDJ.

## Requisitos del operador

- Mac Intel o Apple Silicon M1–M5 con macOS 11 o posterior.
- VirtualDJ y Network Control activos.
- Biblioteca local o disco de karaoke conectado.
- Internet.
- Usuario Host, contraseña permanente y asignación creados por el Superhost.

El operador solo necesita la app, sus credenciales y la asignación entregada por
el Superhost; no necesita Node, npm ni Terminal.

## Instalación

1. Descomprime `Guest-Star-Bridge-Universal-v4.2.0-app.zip` o abre el DMG.
2. Mueve **Guest Star Bridge.app** a Aplicaciones.
3. La primera vez usa clic derecho → **Abrir**.
4. Inicia sesión con el usuario Host y su contraseña permanente.
5. Selecciona hotel, sede y actividad entre tus asignaciones.
6. En Settings, elige las carpetas locales y configura Network Control.
7. Prueba VirtualDJ y sincroniza.

La configuración técnica heredada solo aparece para el Superhost al migrar una
instalación 3.x. En 4.1 el flujo normal utiliza cuenta y token de dispositivo;
los secretos se guardan en macOS Keychain.

## Operación

- **Start Activity** comienza el reloj real.
- **Requests** abre o cierra solicitudes sin reiniciar el evento.
- **Finish Activity** termina el ciclo conservando historial.
- **Share** muestra el enlace permanente y QR del hotel.
- El menú adicional permite cambiar actividad, archivar la cola o cerrar sesión.
- Al iniciar sesión como Superhost, Bridge abre su administración bilingüe
  integrada; **Evento en vivo** regresa a la operación de karaoke.
- **Aleatorio · Random** genera rondas en español, inglés, ambas listas o los
  favoritos del hotel sin repetir antes de completar cada vuelta.

Las solicitudes se separan en pendientes, cola VDJ y completadas, sin perder su
número de llegada. Cada tarjeta muestra idioma, duración, transición,
dedicatoria, acumulado y turno estimado. Las pistas externas agregadas
directamente a VirtualDJ también aparecen y cuentan en el tiempo confirmado.

## Búsqueda y biblioteca

Bridge vigila las carpetas en tiempo real y conserva el último inventario válido
si un disco falla temporalmente. La ruta confirmada por VirtualDJ también cuenta
como evidencia local.

Cuando falta una pista, se muestran hasta seis opciones con letra en el idioma
elegido. No existe caída silenciosa a inglés. Guest Star conserva un solo mejor
enlace y cualquier opción elegida por el Host reemplaza esa misma fuente.

## Reconciliación VirtualDJ

- identidad estable para cada entrada;
- confirmación y reintento de inserciones;
- ventana de gracia para evitar duplicados;
- tres lecturas ausentes antes de confirmar una retirada;
- restauración al turno anterior, al final o fuera de la cola;
- pistas saltadas excluidas del total y pistas ya cantadas conservadas.

Consulta `../VIRTUALDJ-SYNC.md` y `../QUEUE-RECONCILIATION.md` para el diseño
completo.

## Seguridad

- servidor local limitado a `127.0.0.1`;
- credenciales en macOS Keychain;
- archivo de configuración con permisos `0600`;
- token de dispositivo separado de la sesión web;
- selección y permisos verificados de nuevo por el servicio Guest Star.

## Pruebas

```bash
npm test
```
