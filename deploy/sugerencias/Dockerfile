# Endpoint de sugerencias de ChispaBox. Contexto de construcción: deploy/sugerencias/
FROM node:22-alpine3.23

# Parches de seguridad de Alpine publicados después de la imagen base
RUN apk upgrade --no-cache

WORKDIR /app
ENV NODE_ENV=production

# Dependencias fijadas por package-lock.json (solo producción)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# En ejecución no hace falta el gestor de paquetes: se elimina para reducir la superficie
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY server.mjs ./
COPY assets ./assets

# Usuario sin privilegios incluido en la imagen oficial de Node
USER node
EXPOSE 3000

CMD ["node", "server.mjs"]
