# Seguridad de Guest Star 4.0

## Modelo de confianza

- Google Apps Script se ejecuta como el Superhost y es el único componente que
  abre la hoja maestra o las hojas de hotel.
- El navegador Host usa una cookie de sesión `HttpOnly`, `SameSite=Lax` y
  `Secure` en producción. El token no queda disponible para JavaScript.
- El Bridge usa un token de dispositivo diferente y guarda secretos en macOS
  Keychain; el archivo de configuración se limita a permisos `0600`.
- Contraseñas, sesiones, códigos y tokens se guardan como hashes, no en claro.
- Los códigos Bridge→web vencen a los 90 segundos y solo funcionan una vez.

## Aislamiento multi-hotel

Cada petición autenticada resuelve primero el usuario, después sus asignaciones
y por último hotel, sede y actividad. Los identificadores enviados por el
cliente no conceden acceso por sí solos. Los permisos más específicos pueden
restringir permisos heredados.

## Recomendaciones

- Usa contraseñas únicas y revoca dispositivos que ya no estén en servicio.
- No publiques `/exec`, cookies, tokens, PIN legado ni la hoja maestra.
- Limita quién puede entrar a la cuenta Google del Superhost.
- Revisa el registro de auditoría después de cambios de personal.
- Conserva una copia exportada antes de cada actualización mayor.
- Configura ambos dominios web con HTTPS.

El PIN heredado se mantiene solo para compatibilidad durante la migración. Las
instalaciones 4.0 deben utilizar cuentas y tokens de dispositivo.
