# Banco do Cub's com @cubs/rqlite-client

O backend instala `@cubs/rqlite-client@1.0.0` como dependência npm. O pacote
contém `createClient`, transporte HTTP, SQLBuilder, decorators, compilação de
schemas, migrations, CLI e health. O código-fonte da biblioteca fica no repositório
`imheldermartins/rqlite-client`; este projeto guarda somente sua configuração e
suas regras de domínio. Código, exemplos e instruções de instalação estão no
[repositório público](https://github.com/imheldermartins/rqlite-client).
Versão publicada: [@cubs/rqlite-client@1.0.0](https://www.npmjs.com/package/@cubs/rqlite-client).

## Estrutura e conexão

- `rqlite.config.ts`: fontes dos schemas, saída gerada, histórico e ambientes.
- `src/db/schemas/`: as 19 tabelas decoradas, tipos de domínio e inputs.
- `src/db/migrations/`: journal e migrations append-only do Cub's.
- `src/db/generated/`: descritores e tipos inferidos; atualizados pelo CLI.
- `src/db/client-db.ts`: singleton `db = createClient({schema, connection,
  migrations})`, usando `DATABASE_URL`.
- `src/db/repositories/`: consultas, regras de acesso e guardas transacionais
  próprias do Cub's. O pacote não conhece tabelas nem políticas do produto.

`DATABASE_URL` é obrigatório. Em dev, o Compose expõe
`http://127.0.0.1:8000`; no Compose de produção o backend usa
`http://rqlite:4001`. Os arquivos `.env.*.example` mostram os valores. A
construção do cliente não acessa o banco. Antes de abrir a porta, o servidor
executa `db.waitForDatabase()` e `db.assertReady()`; `/health/ready` usa
`db.isReady()` do mesmo singleton. Migrations são aplicadas explicitamente pelo
CLI, antes de iniciar o servidor no entrypoint Docker.

## Fluxo manual

```powershell
npm ci
docker compose -f docker/docker-compose.dev.yml up -d
# Edite ou crie src/db/schemas/MinhaEntidade.schema.ts.
npx rqlite create migration "adicionar minha entidade"
npx rqlite migrate --env-file .env.development --environment development
npx rqlite check --env-file .env.development --database --environment development
npm run dev
```

`rqlite create migration` atualiza o cliente gerado. `rqlite generate` atualiza
apenas descritores e tipos, sem criar migration. `rqlite init` só é necessário
em projetos novos. `npm run rqlite:dev` acompanha os schemas: em desenvolvimento,
aplica automaticamente migrations prontas, suspende o servidor diante de draft ou
schema pendente e o reinicia quando o histórico estiver pronto. Produção não
aplica drafts, migrations manuais ou alterações destrutivas sem opções explícitas.

`@CreatedAt()` e `@UpdatedAt()` já declaram coluna e default de banco, são
herdados e ficam fora dos inputs gerados. Colunas de texto usam TEXT; colunas JSON
usam codec sobre TEXT. `page_columns_values.data` permanece texto bruto sob
`VALUE_CODECS`. O SQL das 19 tabelas vem dos decorators, sem `legacySql`.

A cadeia atual tem uma migration inicial gerada para banco vazio. As 24 migrations
anteriores estão arquivadas intactas em `docs/archive/rqlite-pre-client`; não são
aplicadas pelo novo startup. O banco normal `cubs-rqlite` com histórico anterior
não recebe essa cadeia automaticamente. Use um banco novo para ela; os validadores
abaixo usam containers descartáveis.

## Verificação

```powershell
docker compose -p cubs-rqlite-test -f docker/docker-compose.rqlite-test.yml up -d
npx rqlite migrate --environment test
npx rqlite migrate --environment foreignKeys
node --import tsx scripts/validation/rqlite-schema-test.ts 18012
node --import tsx scripts/validation/rqlite-schema-test.ts 18014
npx tsc --noEmit
npm test
npm run rqlite:test:cubs
npm run build
docker build -t cubs-backend:rqlite-validation .
node scripts/validation/rqlite-container-test.mjs
```

O teste do container recria somente o serviço descartável `production`, confere
startup, FK, health HTTP e restart sem reaplicação. A biblioteca tem suíte, CI e
smoke de instalação próprios em seu repositório. Consulte seu README para começar
um projeto novo somente com `npm install @cubs/rqlite-client@1.0.0`.
