# Reconciliación de la cola

La fila de solicitud conserva su número de llegada aunque VirtualDJ cambie el
orden de reproducción.

## Estados visibles

- **Waiting to Enter the Queue**: solicitud recibida, todavía fuera de VDJ.
- **In the VirtualDJ Queue**: entrada confirmada en la cola real.
- **Completed / Finished**: ya cantó, fue saltada o terminó su ciclo.

Bridge usa identidad estable, ruta, cantante y metadatos normalizados para
comparar. Tolera pequeñas diferencias de artista, mantiene duplicados legítimos
y muestra pistas agregadas directamente en VirtualDJ como externas.

Cada fila física de la cola es autoritativa. Bridge nunca elimina una pista por
parecer repetida: vincula como máximo una fila a cada solicitud y conserva las
demás como pistas externas. Los identificadores técnicos permanecen internos;
VirtualDJ recibe nombres legibles como `Alex A` y `Alex B`.

Una desaparición se confirma después de tres lecturas. Al marcar **Completed** o
**Skipped**, puede deshacerse y restaurarse la pista en su posición anterior, al
final o fuera de la cola. Las canciones saltadas no cuentan en el total; las ya
cantadas sí permanecen incluidas.

Los tiempos se calculan con la duración real reportada por VirtualDJ más la
transición. El panel muestra acumulado, turno estimado y hora final para ayudar
al EMCEE a respetar el cierre del evento.
