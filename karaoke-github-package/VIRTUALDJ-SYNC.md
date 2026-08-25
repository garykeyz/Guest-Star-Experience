# Sincronización con VirtualDJ

Bridge y VirtualDJ deben ejecutarse en la misma Mac. La cuenta Google, las hojas
y el formulario permanecen en la nube.

## Flujo

1. Bridge inicia sesión con la cuenta Host y registra la Mac como dispositivo.
2. El operador selecciona hotel, sede y actividad autorizados.
3. Network Control informa la cola Karaoke real.
4. Bridge cruza cada entrada con solicitud, cantante, metadatos y ruta local.
5. Las pistas agregadas directamente en VirtualDJ aparecen como externas y
   cuentan en el tiempo confirmado.
6. Los cambios enviados desde `/host` llegan como comandos idempotentes al
   dispositivo correcto.

Bridge consulta las propiedades de Network Control en serie, reintenta solo las
lecturas seguras y confirma nuevamente el número de pistas al terminar. Si la
cola cambia durante la captura, descarta esa vista parcial y vuelve a leerla.
Los comandos de escritura nunca se reintentan automáticamente.

Bridge espera tres lecturas ausentes antes de declarar retirada una pista y
aplica una ventana de gracia después de insertar. Mientras VirtualDJ confirma,
la solicitud queda bloqueada contra un segundo envío. Esto evita duplicados y
falsos “falta local” causados por demoras o respuestas perdidas.

Si una Mac se pierde o cambia de operador, el Superhost debe revocar el
dispositivo y autorizar uno nuevo.
