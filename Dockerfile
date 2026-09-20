# Backend Cub's — build reproduzível e runtime mínimo de produção.
FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS dependency-toolchain

# A imagem oficial traz npm 11.19.0. As etapas que resolvem dependências usam
# a versão declarada em packageManager; a imagem final continua limpa.
RUN npm install --global npm@12.0.2

FROM dependency-toolchain AS build-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

WORKDIR /app
COPY --from=build-dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY scripts/copy-mail-templates.mjs ./scripts/copy-mail-templates.mjs
COPY src ./src
RUN npm run build

FROM dependency-toolchain AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime

ENV NODE_ENV=production \
    WAIT_FOR_DATABASE=true \
    RUN_MIGRATIONS=true

WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chmod=0555 docker/backend/entrypoint.sh /usr/local/bin/cubs-backend-entrypoint

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/cubs-backend-entrypoint"]
CMD ["node", "dist/server.js"]
