# rqlite-client: execução e criação do zero

> Registro da implementação local anterior à extração. O estado operacional e
> os comandos atuais estão em [RQLITE_CLIENT.md](../RQLITE_CLIENT.md).

Esta etapa substitui a nomenclatura e o fluxo de compatibilidade do plano anterior.
Pedido aceito: biblioteca `rqlite-client`, executável `rqlite`, cliente tipado e
orquestração pertencentes ao pacote. Depois, o usuário direcionou a validação para
uma base vazia, removendo CREATE TABLE legado dos schemas e simplificando clocks.

## Implementado

- Workspace e imports padronizados; `createClient({schema, connection, migrations})`
  infere `client.models.<tabela>` sem generics por consumidor. Construção sem I/O;
  aplicação de migrations e readiness são operações explícitas.
- CLI `rqlite init/generate/check/create migration/finalize migration/migrate/watch/prepare/wait`.
  O CLI e `createProject`/`loadProject` usam os mesmos serviços. Opções desconhecidas
  e subcomandos inválidos falham antes de executar uma operação.
- CRUD, SQLBuilder, serialização e política genérica de soft delete migrados ao
  pacote. O Model do Cub's injeta somente transporte compatível e guardas de páginas.
- `prepare` verifica migrations JS, copia metadata e gera configuração runtime;
  entrypoint Docker chama o pacote para wait/migrate/check. Scripts antigos removidos.
- 19 schemas sem `legacySql`, tipos físicos inferidos e constraints declaradas;
  bases `IdentitySchema` e `BaseSchema`. `CreatedAt`/`UpdatedAt` declaram coluna e
  default, são herdados e não aparecem em inputs de insert/update.
- Uma migration inicial gerada substitui o replay antigo em instalações novas.
  As 24 migrations anteriores e metadata estão arquivadas com bytes preservados em
  `docs/archive/rqlite-pre-client`; não são executadas pelo novo fluxo.

## Verificação

- Base vazia no rqlite 10.3.3 com FK desligado (18012) e ligado (18014).
- Inspeção real das 19 tabelas: tipos, nulabilidade, clocks, texto bruto de células,
  foreign_key_check sem violações e aplicação repetida sem pendências.
- Backend: 49 arquivos / 238 testes aprovados com integração habilitada; SQL injection
  (9 verificações), workspace, páginas/células e acesso HTTP aprovados.
- Pacote: 8 arquivos / 16 testes aprovados com integração, incluindo concorrência,
  rollback, perda de resposta, draft/fork/drift, inferência e construção sem I/O.
- O mesmo tarball foi instalado e validado fora do repositório no Windows e no
  Linux: executável via npm exec/npx, API programática, inferência de inputs e
  rejeição de clocks externos, CRUD, watch, prepare e readiness compilada.
- Typecheck e build aprovados. Container real aprovado com uma migration em banco
  vazio, FK ligado, health HTTP 200 e restart sem reaplicação; startup compilado
  executado com imports de compiler/tsx bloqueados.
- Hashes SHA256 das 24 migrations arquivadas conferidos com a captura anterior.
  Resultados detalhados e tarball ficam em `artifacts/rqlite-validation`.

## Continuidade

O novo histórico exige banco vazio. O banco normal `cubs-rqlite` permaneceu intacto;
não foi presumido backup de dados a partir do backup de código. Nesta etapa
anterior não houve commit, push ou publicação. A saída de build foi preservada
nos artefatos.

O pacote desta etapa era privado no workspace e instalável por tarball. A
extração posterior criou `C:\Projects\rqlite-client` como repositório Git
independente, com licença MIT, `@cubs/rqlite-client@1.0.0`, README e CI.
Browser e failover multinó não fazem parte desta validação; CI foi atualizado,
mas não disparado remotamente. Uso atual: [guia do cliente](../RQLITE_CLIENT.md).

## Publicação e instalação pelo registry (25/09/2026)

- Repositório público: [imheldermartins/rqlite-client](https://github.com/imheldermartins/rqlite-client),
  commit `a4d7d9c8f23112a609dc494e6573e64dd7757c5c`, tag `v1.0.0`.
- Pacote público: [@cubs/rqlite-client@1.0.0](https://www.npmjs.com/package/@cubs/rqlite-client),
  dist-tag `latest=1.0.0`; integridade do registry
  `sha512-LlXApjqiTzDBDO2aB+A0NHxW7EvDU+Z9tXimSkdWl0csuaVHWIpZDQDTTts5WPMP+K963Ym1NMz7HPEs8fiYKA==`.
  O metadata público preserva `bin.rqlite=dist/cli/index.js`.
- CI do pacote no GitHub aprovado em Windows e Linux, incluindo integração real
  no Linux (17 testes). Instalação limpa pelo nome do pacote aprovada fora do
  backend: `createClient` sem schema, SQL `SELECT 1`, readiness e CLI `rqlite`.
- Backend: `package.json` fixa `1.0.0`; `package-lock.json` aponta para o tarball
  público, sem caminho local. `npm ci`, typecheck, 223 testes unitários, build,
  integração de páginas/acesso/workspace/SQL injection e container compilado
  aprovados. O container aplicou a migration em rqlite descartável, expôs health
  200 e reiniciou sem reaplicação.
- A worktree do backend permanece com alterações locais pré-existentes e não
  recebeu commit ou staging nesta publicação. O banco normal `cubs-rqlite`
  permaneceu intacto; testes com banco usam serviços descartáveis.
