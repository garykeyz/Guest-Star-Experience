# Guest Star Experience

Formulario premium multilingüe para solicitudes de karaoke.

## Tecnologías

- Next.js
- React
- TypeScript
- Tailwind CSS
- Framer Motion
- Lucide React
- Cloudflare Workers
- Google Apps Script / Google Sheets

## Estructura

```text
app/
  globals.css
  layout.tsx
  page.tsx
  typography.css
components/
  KaraokeExperience.tsx
public/
  favicon.svg
```

## Desarrollo

```bash
npm install
npm run dev
```

## Publicación en Cloudflare

```bash
npm run deploy
```

Para despliegues automáticos desde GitHub:

- Build command: `npx opennextjs-cloudflare build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

El endpoint de Google Apps Script se encuentra en
`components/KaraokeExperience.tsx`.
