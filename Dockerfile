# Backend Cub's — imagem de produção (porta 3000).
#
# Roda via tsx (não `node dist/`): o tsc NÃO reescreve os path aliases do
# tsconfig (@/, @core/, @models/...), então o JS compilado quebraria no
# import. O tsx resolve os aliases em runtime, igual ao dev.
#
# Envs (PORT, JWT_*, CORS_ORIGINS, RQLITE_*) vêm do compose
# (docker/backend.prod.env) — não há .env dentro da imagem.
FROM node:24-alpine

WORKDIR /app

# Camada de dependências separada para aproveitar cache entre builds.
# npm ci inclui devDependencies de propósito: tsx e typescript ficam lá.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]
