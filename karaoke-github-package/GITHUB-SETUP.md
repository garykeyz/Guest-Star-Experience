# Karaoke Night — GitHub Setup

## Subir el código

1. Crea un repositorio vacío en GitHub.
2. Descomprime este paquete.
3. Sube todos los archivos, incluyendo las carpetas `app`, `public`, `worker` y `.openai`.

## Desarrollo local

Requiere Node.js 22 o superior.

```bash
npm install
npm run dev
```

## Validar la compilación

```bash
npm run build
```

## Google Sheets

El formulario ya está conectado al receptor de Google Apps Script configurado en `app/page.tsx`.

No elimines ni cambies `REQUEST_ENDPOINT` a menos que publiques una nueva implementación de Apps Script.

## Alojamiento

GitHub puede almacenar y versionar el código. Esta configuración utiliza Vinext y un Worker compatible con Cloudflare, por lo que para publicarla como aplicación se recomienda:

- Cloudflare Workers
- El alojamiento actual de ChatGPT Sites

GitHub Pages no ejecuta el Worker de esta configuración sin convertir previamente el proyecto a una exportación completamente estática.
