# Guest Star Bridge 4.3.5

Aplicación local Universal para Mac que conecta Guest Star con la biblioteca de
karaoke y la cola Karaoke real de VirtualDJ.

## Requisitos del operador

- Mac Intel o Apple Silicon M1–M5 con macOS 11 o posterior.
- VirtualDJ y Network Control activos.
- Biblioteca local o disco de karaoke conectado.
- Internet.
- Usuario Host o Superhost, correo y asignación creados por el Superhost. Puede
  usar contraseña permanente o la cuenta Google con ese mismo correo.

El operador solo necesita la app, sus credenciales y la asignación entregada por
el Superhost; no necesita Node, npm ni Terminal.

## Instalación

1. Descomprime `Guest-Star-Bridge-Universal-v4.3.5-app.zip` o abre el DMG.
2. Mueve **Guest Star Bridge.app** a Aplicaciones.
3. La primera vez usa clic derecho → **Abrir**.
4. Inicia sesión con el usuario y contraseña, o pulsa **Continuar con Google**.
   Google se abre en Safari/Chrome para evitar un acceso inseguro dentro del
   WebView y regresa automáticamente al Bridge al terminar.
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
directamente a VirtualDJ permanecen en una sección separada y cuentan en el
tiempo confirmado sin convertirse en solicitudes en línea.

La interfaz puede cambiarse completamente entre Español e English. Los valores
técnicos de error de VirtualDJ nunca se convierten en solicitudes y el último
estado válido de la cola se conserva si Network Control devuelve un error.

En 4.3.5, las propiedades de cada fila se leen en orden para mantener estable
Network Control. El conteo se verifica al terminar y se repite la captura si la
cola cambió durante la lectura. Las pistas externas nunca se borran por parecer
duplicadas y una inserción pendiente no puede enviar una segunda copia.

## Búsqueda y biblioteca

Bridge vigila las carpetas en tiempo real y conserva el último inventario válido
si un disco falla temporalmente. La ruta confirmada por VirtualDJ también cuenta
como evidencia local.

Cuando falta una pista, se muestran hasta seis opciones con letra en el idioma
elegido. No existe caída silenciosa a inglés. Guest Star conserva un solo mejor
enlace y cualquier opción elegida por el Host reemplaza esa misma fuente.

## Reconciliación VirtualDJ

- identidad estable para cada entrada;
- alias visual por dispositivo (`Alex A`, `Alex B`, etc.) con colores distintos
  cuando coinciden nombres, conservando internamente el código anónimo;
- reconocimiento de título y artista invertidos;
- eliminación verificada de copias repetidas en la cola Karaoke real;
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
- el token de identidad Google se valida en el servidor contra el cliente OAuth;
  una cuenta desconocida nunca crea automáticamente un usuario Guest Star.

## Pruebas

```bash
npm test
```
