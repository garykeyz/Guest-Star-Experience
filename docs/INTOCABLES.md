# Funciones intocables de Guest Star

## Biblioteca de audio/video y vinculación de solicitudes — 28 octubre 2026

Por instrucción expresa de Gary, este comportamiento queda protegido:

- Elegir una carpeta de AUDIO o VIDEO guarda la selección y actualiza la biblioteca inmediatamente, sin un segundo guardado.
- Las carpetas Karaoke generales y las de Audio/Video alimentan el índice consultado por biblioteca, coincidencias y vínculos de solicitudes en Player y Bridge.
- Las coincidencias seguras se vinculan automáticamente; se conservan umbrales de confianza, margen de ambigüedad y decisiones manuales del Host.
- Añadir o retirar archivos dispara actualización automática; las selecciones y vigilancia se recuperan tras reiniciar.
- Un cambio de fuentes no cambia la pista en reproducción, los IDs, estados, orden ni decisiones de las solicitudes, ni envía canciones a VirtualDJ.
- Las fuentes de música de fondo permanecen independientes. No copiar rutas entre música de fondo y Karaoke.
- La actualización local no espera a la nube ni a YouTube. Los errores de lectura deben aparecer al guardar.

No alterar este contrato en tareas ajenas. Toda reparación autorizada que lo afecte requiere respaldo y ejecutar las regresiones `test/karaoke-source-folders-http.test.mjs` y `test/karaoke-source-preferences.test.mjs`, además de la suite pertinente y comprobación en la app instalada.
