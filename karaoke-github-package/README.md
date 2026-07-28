# Guest Star Experience — Karaoke Host

## Instalar en GitHub
Sube el contenido de esta carpeta dentro de `karaoke-github-package`, reemplazando los archivos existentes.

Cloudflare:
- Root directory: `karaoke-github-package`
- Build command: `npx opennextjs-cloudflare build`
- Deploy command: `npx wrangler deploy`

## Google Apps Script
1. Abre la hoja y entra a Extensiones → Apps Script.
2. Reemplaza `Code.gs` por `google-apps-script/Code.gs`.
3. Ejecuta `setup`.
4. Ejecuta `configurarCredenciales`.
5. Implementar → Administrar implementaciones → Editar.
6. Selecciona **Nueva versión**, ejecutar como tú y acceso para **Cualquier persona**.
7. Confirma que la URL `/exec` continúe siendo la misma.

El menú **🎤 Karaoke** permitirá abrir, cerrar y reiniciar desde la hoja. El botón **HOST** de la página utiliza el mismo PIN.
