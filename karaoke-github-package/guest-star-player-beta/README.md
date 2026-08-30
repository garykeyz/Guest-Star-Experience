# Guest Star Beta

Prototipo histórico de la aplicación **Guest Star**. La aplicación integrada
oficial vive en `guest-star-bridge` desde Guest Star 4.4.0.

## Nombres y modos

- **Guest Star** es la aplicación y el núcleo compartido: Host, Superhost, Request, actividades, hoteles, solicitudes e historial.
- **Guest Star Player** es el modo interno para archivos locales, Lobby y pantallas; no necesita VirtualDJ.
- **Guest Star Bridge** es exclusivamente el modo de integración con VirtualDJ.
- una actividad usa un solo modo operativo a la vez para impedir colas duplicadas.

## Ejecutar localmente

```bash
cd guest-star-player-beta
npm start
```

Abrir `http://127.0.0.1:4310`, añadir archivos de audio o vídeo locales y operar la cola.

## Alcance de 0.3

- cola propia en memoria con estados `Pendiente`, `Sonando`, `Cantada` y `Saltada`;
- reproducción de archivos locales desde el navegador;
- marcar una pista como cantada o saltada sin que vuelva a la cola;
- panel Host con **devolver a fila**, **saltar** y **cantada + siguiente**;
- Lobby para TV/teleprompter con logo, QR, orden de cantantes y canción actual;
- vídeo local compatible visible como fondo del Lobby, controlado desde Host;
- contrato `PlaybackEngine`, que permitirá sustituir el audio web por el motor nativo de Tauri sin reescribir la cola.

Los archivos nunca se suben ni salen del equipo. En Host completa el hotel, el enlace de la actividad y el logo, y luego pulsa **Abrir Lobby**. Al cerrar esta beta, la cola se limpia a propósito: la persistencia segura será el siguiente paso junto con la aplicación Tauri/macOS.
