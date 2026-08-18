# Horarios y recurrencia

Cada actividad pertenece a una sede y utiliza la zona horaria del hotel.

## Programar

1. Selecciona la actividad en `/host`.
2. Abre **Schedule and Recurrence**.
3. Indica fecha y hora local, duración y minutos de apertura anticipada.
4. Elige sin repetición, diaria, semanal, quincenal o mensual. Para semanal o
   quincenal marca uno o varios días de la semana; mensual conserva el día del
   mes y usa el último día válido cuando el mes es más corto.
5. Activa, si deseas, apertura automática de solicitudes.
6. Activa inicio automático solo cuando la política del hotel lo permita; es
   una opción separada y explícita.
7. Guarda.

Un activador de Apps Script revisa los horarios cada minuto. La recurrencia se
calcula como calendario local del hotel para evitar desplazamientos por horario
de verano. El reloj de actividad comienza únicamente al iniciar, manual o
automáticamente según la opción guardada.

La página pública puede mostrar cuenta regresiva, siguiente actividad y enlace
**Add to Calendar** según la identidad configurada por el Superhost.

Una actividad se puede abrir desde **Editar** para cambiar nombre, duración,
transición e idiomas. **Eliminar actividad** la desactiva de forma recuperable,
cancela su agenda y cierra su operación pública; **Restaurar** vuelve a dejarla
disponible sin perder su historial.
