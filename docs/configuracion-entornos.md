# Configuración por entorno

Este documento separa lo que se controla desde el repositorio de lo que depende del servidor, del plan de hosting o del DNS. No incluye credenciales ni rutas de un equipo concreto.

## 1. Desarrollo local (`npm run dev`)

- Vite arranca en `http://localhost:5173` por defecto. Para cambiarlo, usar la variable `PORT` (ver `vite.config.ts`) en `.env.local`, que no se versiona.
- `predev` copia los recursos de pdf.js a `public/pdfjs/` (≈0,4 s). Es una carpeta ignorada por git.
- Las herramientas locales (descargas de YouTube, OCR, conversión de documentos) solo existen en el servidor de desarrollo y en `CHISPABOX_LOCAL=true`. Sus variables están documentadas en `.env.example`.
- Los límites de las descargas de YouTube (trabajos simultáneos, tamaño de cuerpo de petición) están en `extras/local/server/youtube/config.ts` y `api.ts`.

## 2. Compilación pública (`npm run build`)

Lo que hace el build (`vite.config.ts` y `server/`):

| Paso | Qué hace | Archivo |
| --- | --- | --- |
| Entradas | Solo páginas públicas. Las páginas locales se excluyen en `SOLO_DESARROLLO`. | `vite.config.ts` |
| Metadatos | `canonical`, Open Graph y JSON-LD por página. | `server/seo-head.ts` |
| HTML | Se quitan sangría y líneas vacías. `pre`, `textarea`, `script` y `style` no se tocan. | `server/html-minify.ts` |
| Sitemap | `sitemap.xml` con las páginas que se compilan en la versión pública. | `server/seo-head.ts` |
| CSS | Purga con PurgeCSS tras el build (`postbuild`). Conserva clases dinámicas, estados (`is-`, `has-`, `data-*`, `aria-*`). | `scripts/purgar-css.mjs` |
| JS | División por página. La home carga solo `main` y el CSS. | Vite (automático) |

Comando para compilar la versión local con herramientas incluidas: `CHISPABOX_LOCAL=true npm run build`. No usar esa salida para publicar.

## 3. Producción: cabeceras de caché y compresión

Esta política está en `nginx.conf` (el contenedor de ChispaBox) y en `deploy/proxy/Caddyfile`.

| Recurso | Política | Motivo |
| --- | --- | --- |
| `/assets/*` (JS/CSS con hash en el nombre) | `expires 1y` | El nombre cambia al cambiar el contenido, así que se puede cachear mucho tiempo. |
| `/images/*` (ilustraciones, logo) | `expires 30d` | Tienen nombre fijo; un cambio de imagen necesita nuevo nombre o esperar 30 días. |
| `/favicon.png` | `expires 30d` | Igual que las imágenes. |
| `/theme-init.js` | `expires 1d` | No tiene hash en el nombre; caché corta para que los cambios lleguen pronto. |
| HTML (`/`, páginas) | `expires -1` (`no-cache`) | Permite recibir actualizaciones del HTML en cada visita. |
| Compresión | `gzip on` (nginx), `encode zstd gzip` (Caddy) | Brotli no está configurado. |

Cabeceras de seguridad actuales (sin cambios en esta revisión): `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` y una CSP. La CSP usa `script-src 'self'`, por eso el script de tema sigue siendo un archivo externo.

## 4. Lo que depende de Hostinger, DNS o del servidor

No se puede resolver solo desde el repositorio:

- **Brotli:** requiere módulo o soporte del servidor. Con gzip ya activo, el ahorro adicional es moderado.
- **HSTS:** solo tras confirmar que todo el dominio y los subdominios sirven HTTPS. Activarlo mal puede bloquear el sitio durante meses.
- **CSP con hash o nonce:** requiere cambiar la CSP y verificar el script de tema. No se ha cambiado.
- **Registro CAA y `security.txt`:** DNS y contacto de seguridad (pendiente de confirmar).
- **Formulario de sugerencias y envío de correos:** requiere el servicio de `deploy/sugerencias/` (Node) y SMTP. En el VPS (Hostinger KVM 2) puede correr con Docker según `deploy/`, pero el SMTP y las variables de `sugerencias.env` se configuran en el servidor y no están verificados aquí.
- **Despliegue en el VPS:** `compose.yaml` y `deploy/` describen los contenedores (nginx con `nginx.conf` y el proxy de Caddy). Aplicarlos, cambiar DNS o modificar el VPS queda fuera de este trabajo.

## 5. Notas de mantenimiento

- No añadir rutas absolutas del equipo en configuración versionada.
- Los puertos son valores por defecto de Vite; no fijar puertos en scripts sin necesidad.
- Antes de desplegar, comprobar que `dist/` no contiene herramientas locales (`descargar-*`, `ocr-*`, `transcribir-*`, `pdf-a-documento`).
