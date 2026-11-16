# syntax=docker/dockerfile:1

# ---------- Etapa 1: instalar dependencias y compilar (Node Alpine) ----------
FROM node:22-alpine AS build

WORKDIR /app

# Copiar primero los manifiestos para aprovechar la caché de capas
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Todas las páginas HTML de la raíz (las nuevas incluidas) y sus plantillas compartidas en templates/
COPY tsconfig.json tsconfig.server.json vite.config.ts *.html ./
COPY templates ./templates
COPY paginas ./paginas
COPY public ./public
COPY server ./server
COPY src ./src
# Los scripts de prebuild (copy-pdfjs.mjs y copy-ocr.mjs) deben estar en la imagen de compilación
COPY scripts ./scripts
RUN npm run build


# ---------- Etapa 2: servir archivos estáticos (Nginx sin root) ----------
FROM nginxinc/nginx-unprivileged:1.30.3-alpine3.23 AS runtime

LABEL org.opencontainers.image.title="chispabox-web" \
      org.opencontainers.image.description="Landing estática de ChispaBox — Pequeñas herramientas, grandes soluciones."

# Parches de seguridad de Alpine y eliminación de curl (el healthcheck usa wget de BusyBox).
# libxml2 (CVE-2026-86140, sin parche en Alpine 3.24) lo arrastran los módulos dinámicos
# nginx-module-xslt y nginx-module-njs. nginx.conf no los carga (sin load_module), así que se
# eliminan junto con libxslt y libxml2. Si algún día se necesitan, reevaluar este bloque.
# Estos comandos requieren root en la etapa de construcción; el usuario vuelve a "nginx" después.
USER root
RUN apk upgrade --no-cache \
 && apk del --no-cache curl nginx-module-xslt nginx-module-njs libxslt libxml2
USER nginx

# Configuración de Nginx propia (escucha en 8080, sin privilegios)
COPY --chown=root:root nginx.conf /etc/nginx/conf.d/default.conf

# Solo los archivos compilados: sin Node, sin dependencias de desarrollo ni código fuente
COPY --from=build --chown=root:root /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
