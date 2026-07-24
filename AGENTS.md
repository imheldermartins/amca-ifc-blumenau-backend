# AGENTS.md — Backend do Cub's

API Express + socket.io do Cub's (plataforma de páginas estilo Notion-lite),
persistindo em **rqlite** (SQLite distribuído, falado via HTTP).

## Comandos

- `docker compose -f docker/docker-compose.dev.yml up -d` — rqlite dev
  (porta publicada só em `${RQLITE_ALLOWED_HOST:-127.0.0.1}:8000`)
- `npm run dev` — express + socket.io em :3000 (carrega `.env.development`)
- `npm run migrate` / `migrate:create` / `migrate:prod` — migrations
- `npm run seed` — popula base IFC (exige `.env.seed` com `SEED_USER_PASSWORD`)
- `npx tsc --noEmit` — typecheck (rode antes de encerrar mudanças)
- Prod: `docker compose -f docker/docker-compose.prod.yml up -d --build`
  (frontend nginx :80 + backend :3000 + rqlite interno; requer `cubs-frontend`
  clonado ao lado e os `docker/*.prod.env` preenchidos a partir dos `.example`)

## Arquitetura (camadas, de fora para dentro)

- `src/routes/` — routers HTTP (`BaseRouter` dá o CRUD; rotas extras entram no
  construtor). Documentação Swagger em JSDoc `@openapi` na própria rota
  (`/api-docs`). Erros SEMPRE `{ message }` + `StatusCode` (as const).
- `src/controllers/` — singletons; try/catch que loga e retorna `null`/Result
  (`{ ok, reason }`); nunca conhecem req/res.
- `src/models/` — `Model<T>` genérico por tabela (`jsonColumns` para colunas
  JSON). Schemas de domínio em `src/models/schemas/index.ts` (namespace
  `Schema`), inputs HTTP em `schemas/inputs`.
- `src/core/db/` — SQLBuilder (squel) + `shared.ts` (fetch ao rqlite).
  **REGRA: SQL cru só existe dentro de `core/db`.** Exceção sancionada:
  `db.sqlRaw` (re-export de `Model.sqlRaw`) para joins/agregações — quem chama
  fornece a string, o executor continua em core/db.
- `src/core/auth/` — JWT (access 15m / refresh 7d com rotação; bcrypt 10) +
  middleware que põe `req.userId`. `owner_id` vem SEMPRE do token, nunca do
  payload.
- `src/core/http/` — HttpServer por composição; middlewares globais (cors por
  `CORS_ORIGINS`, rate limit `rate-limit.config.ts`) rodam antes das rotas.
- `src/core/socket/` — socket.io pega carona no MESMO http.Server/porta.
  Contrato de eventos espelhado em `cubs-frontend/src/services/SocketService.ts`
  — **evento novo atualiza os DOIS lados**. Trabalho de realtime é tarefa
  futura supervisionada (ver NEXT_STEPS.md §2).

## Modelo de dados (premissas que o código assume)

- **Árvore recursiva de páginas.** Não existe tipo especial de página "raiz":
  **`page_edges`** liga `parent_id` → `child_id` (UNIQUE, antes
  `page_root_id`/`page_id`) + `slug` (segmento de caminho da filha), e QUALQUER
  página pode ser parent de outras. Uma "base" (tabela) é só uma página cujas
  FILHAS são as linhas — o mesmo id é filha num nível e parent no seguinte.
  Tabela renomeada de `page_hubs`.
- As rotas de base aceitam o id de QUALQUER página, sem caso especial:
  `/pages/:id/page` (filhas + valores), `/pages/parent/:id/columns` (colunas do
  parent), `/pages/:id/breadcrumb` (sobe a árvore).
- **Ponto de entrada:** `workspaces.id == pages.id` da página por onde se entra
  na workspace (`GET /workspaces/:id/page_root`, GET-or-create). "root" é
  convenção FALADA da workspace, não um estado da página nem uma coluna: a rota
  só resolve POR ONDE começar — daí para baixo é página → página.
- `pages.data` é campo livre por página; ali mora o **snapshot** — nome OFICIAL
  do padrão de personalização por view: `{ [ulid-da-view]: { view, name,
  filters, orderedHeaderCols, columnWidths? } }`. Cada entrada é o retrato
  COMPLETO da view, não campos remendáveis. Ainda sem rota dedicada — escrita
  pelo PUT genérico de `/pages/:id`, que **substitui `data` inteiro**: salvar
  uma view exige reenviar todas as outras (read-modify-write), senão elas
  somem. Definição canônica, invariantes e estado: **[docs/INTEGRACAO.md](docs/INTEGRACAO.md) §2**
  (leitura pronta em `cubs-frontend/src/lib/databaseParser.ts`; escrita pelo app
  ainda NÃO implementada).
- **Breadcrumb:** `pageController.getBreadcrumb` / `GET /pages/:id/breadcrumb`
  sobem a hierarquia com um CTE recursivo via `db.sqlRaw` PARAMETRIZADO. `slug`
  de arestas novas vem do `slugify` ([utils/slugify.ts](src/utils/slugify.ts));
  o de dados antigos foi backfilled em SQL (best-effort, mantém acento).
- Colunas (`page_columns`) pertencem à página parent — coluna `parent_id`
  (antes `page_root_id`), rotas em `/pages/parent/:id/columns`; valores
  (`page_columns_values`) ligam (página, coluna) e guardam o envelope
  `{"value":<T>}` como TEXTO. A célula é ÚNICA (UNIQUE page_id+page_column_id)
  — rota singular `/pages/:id/column/:column_id/value` (POST em célula cheia
  responde 409).
- **`VALUE_CODECS`** (`src/services/value-codec.ts`) é a ÚNICA fronteira de
  (de)serialização do envelope — por isso `data` de values NÃO está em
  `jsonColumns`. `select` guarda o ULID da option; `date` exige ISO estrito
  `yyyy-mm-ddTHH:mm:ss.sssZ` (range com `@`).
- IDs são ULID (26 chars).

## Migrations

Append-only: NUNCA edite uma migration já aplicada — crie outra
(`npm run migrate:create` pergunta a descrição e gera o arquivo com timestamp).
Registro em `_migrations`; `down` existe mas não há comando de rollback.

## Segurança de SQL

O SQLBuilder produz statements **parametrizados** (`SqlStatement { text, values }`
via `squel.toParam()`): todo valor vira bind `?`, jamais concatenado no texto —
imune a SQL injection e a valores com aspas simples. Identificadores
(tabela/coluna) não são parametrizáveis, então passam por `assertIdentifier`
(`[A-Za-z0-9_]`). `db.sqlRaw` é a exceção (SQL cru): use só com input validado
(ex.: `getDataset` checa o ULID por regex). Teste: `npm run test:sql-injection`
(reproduz o ataque e prova a correção contra o rqlite dev).

## Ambientes

Dev e prod separados: `.env.development` / `.env.production` na raiz (templates
`.example` no git) e `docker/*.prod.env` para os containers. Principais vars:
`PORT` (3000), `CORS_ORIGINS` (lista com vírgulas; vazio = `*`, só dev),
`TRUST_PROXY=1` (só atrás do nginx), `JWT_*_SECRET`, `RQLITE_ADVERTISE_IP` /
`RQLITE_PORT` (vazio+8000 em dev; `rqlite`+4001 no compose prod),
`RATE_LIMIT_*` / `AUTH_RATE_LIMIT_*`.

## Integração com o frontend

Contrato completo, status por peça e armadilhas: **[docs/INTEGRACAO.md](docs/INTEGRACAO.md)**
(versionado — este AGENTS.md não é). Resumo:

- O prefixo `/api` é **real nos dois lados** — o backend monta os routers sob
  `API_PREFIX` e os mediadores (Vite em dev, nginx em prod) repassam o path
  INTACTO. No nginx, é a AUSÊNCIA de barra final no `proxy_pass` que preserva o
  prefixo. `/api-docs` e `/socket.io` ficam fora dele.
- Leitura de base funciona ponta a ponta; **escrita do snapshot ainda não
  existe no app** (`apiService.put` nunca é chamado).

## Avisos

- Rate limit é em memória por instância; múltiplas instâncias exigem store
  compartilhado.
- Usuários do seed (professores IFC + `admin@cubs.local`) logam com a senha
  documentada em `.env.seed` (fora do git).
- **Token sobrevive ao usuário:** o middleware valida só assinatura/expiração.
  Depois de `npm run seed` (que recria `users`), o token velho do browser passa
  na auth com id fantasma e produz 404 confuso no `page_root` — com
  `[SQLERROR] [UNIQUE constraint failed: pages.id]` no console. Sintoma
  diagnóstico: funciona no Insomnia (token novo) e falha no browser (token
  velho). Se a resposta muda com o TOKEN, não é rota nem proxy.
- **`page_root` só existe para um dono por workspace** (`pages.id` é PK e recebe
  o id da workspace). Segundo usuário colide na PK → 404. Decisão de produto
  pendente (ver INTEGRACAO.md §5.2).
