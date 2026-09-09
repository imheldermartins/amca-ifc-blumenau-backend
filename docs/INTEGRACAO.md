# Integração `cubs-frontend` × `cubs-backend`

Contrato entre os dois repositórios e status de cada peça. Documento **canônico**
do que está acordado — quando o código e este arquivo divergirem, o código ganha
e este arquivo é o que precisa ser corrigido.

> **Status: 2026-09-08.** Leitura, escrita, workspaces selecionáveis e realtime
> v1 funcionam ponta a ponta. O protocolo é modular, orientado à página e
> agnóstico ao renderer; contrato e decisão canônica estão em
> [ADR 0001](adr/0001-realtime-v1.md).

---

## 1. Como as duas pontas se encontram

```
browser :5173 (Vite dev)  |  :80 (nginx prod)
    │  axios baseURL = <origem?> + /api          src/lib/connection.ts
    ▼
mediador  — repassa o path INTACTO, sem reescrever
    │      dev : proxy do Vite    (vite.config.ts)
    │      prod: nginx            (nginx/nginx.conf)
    ▼
backend :3000  — routers montados sob API_PREFIX
                 src/core/http/http-server.ts
```

### O prefixo `/api` é REAL nos dois lados

Todos os routers entram sob `API_PREFIX` no `mountRoutes` do
[http-server.ts](../src/core/http/http-server.ts) — um ponto só, então router
novo já nasce prefixado. Os mediadores **não** reescrevem o path.

Isso mudou em 2026-07-19. Antes o `/api` era invenção do mediador e morria nele;
o backend servia na raiz. As duas configurações são plausíveis e a diferença é
invisível até quebrar, então valem os avisos:

| Ponta | O que preserva o prefixo | Como quebra |
|---|---|---|
| Vite | ausência de `rewrite` no proxy | um `rewrite` que fatie `/api` → backend recebe `/pages`, responde 404 |
| nginx | `proxy_pass http://cubs_backend;` **sem** barra final | com `/` no final o nginx troca `/api/pages` → `/pages` → 404 |
| axios | `baseURL` sempre terminando em `/api` | montar a URL sem o prefixo quando `VITE_CUBS_API_URL` está definida |

`VITE_CUBS_API_URL` recebe **só a origem** (`http://localhost:3000`), sem `/api`
— o prefixo é colado no código, em `connection.ts`.

**Fora do prefixo:** `/api-docs` (Swagger UI) e `/socket.io` (handshake do
socket.io) vivem na raiz do backend. Não são rotas de dados.

---

## 2. Snapshot — padronização da personalização por view

**"Snapshot" é o nome oficial deste padrão.** Use o termo em código, comentário,
commit e conversa; ele designa exatamente o que está definido abaixo.

### O que é

`pages.data` é campo livre por página (JSON). Por convenção, ele guarda a
personalização das **views** daquela base, indexada pelo ULID da view:

```jsonc
{
  "01KXVVKQ5DC06250MCYVHMJP1V": {        // ULID da view = identidade canônica
    "view": "table",                      // table | grid | board | calendar | timeline | graph
    "name": "Docentes",                   // rótulo da tab
    "urlKey": { "key": "docentes", "aliases": [] },
    "filters": {
      "version": 2,
      "updatedAt": "2026-09-01T12:00:00.000Z",
      "clauses": [
        {
          "columnId": "01KXDN4B3X8J9NXGSTMK8PRFMF",
          "condition": "contains",
          "values": ["Ana"]
        }
      ],
      "groupBy": ["01KXDN4B3X8J9NXGSTMK8PRFMF"],
      "passthrough": []
    },
    "title": {                            // projeção mestra de pages.title
      "key": "title",                    // identidade canônica e imutável
      "column_name": "Docente",          // rótulo desta view
      "mask": "cpf",                     // opcional; apresentação por view
      "publicKey": { "key": "docente", "aliases": [] }
    },
    "orderedHeaderCols": [                // ordem das colunas; ids de page_columns
      "page_title",                       // + a coluna sintética de título
      "01KXDN4B3X8J9NXGSTMK8PRFMF"
    ],
    "orderedRows": [                      // opcional; ordem das páginas-filhas
      "01KXDN4B3X8J9NXGSTMK8PRFMG"
    ],
    "columnWidths": {                     // opcional; px por coluna
      "page_title": 280
    }
  }
}
```

### Por que "snapshot"

Cada entrada continua sendo o **retrato completo** da personalização daquela
view quando lida. A escrita normal, porém, não reenvia mais `pages.data`
inteiro:

1. `PATCH /pages/:id/views/:viewId` altera somente os campos permitidos da
   view (ordem, largura, nome, título e apresentação).
2. `PUT /pages/:id/views/:viewId/filters` substitui filtros e agrupamentos como
   um único documento atômico e carimba `filters.updatedAt` no servidor.
3. `PUT /pages/:id` ainda substitui `data` inteiro e fica restrito à criação
   inicial da view fallback; usá-lo para uma personalização comum pode apagar
   ou reverter trabalho concorrente.

### Por que assim (decisões deliberadas)

O nome carrega a intenção: **snapshot é estrutura associativa, otimizada para
acesso rápido.** Vem junto com a página numa única leitura (`GET /pages/:id`),
sem join e sem consulta extra — chave → objeto, pronto para uso.

**Ordem é índice de array, não campo numérico.** `orderedHeaderCols` é uma lista
de ids; a posição É a ordem. A alternativa — um `order` inteiro/float por coluna
— exigiria reindexar ou rebalancear frações a cada movimentação, e degrada
justamente onde há muitos elementos já chaveados por id. Reordenar aqui é
produzir um array novo; o patch por view grava essa lista como uma unidade.

**Por que não em `page_edges`.** As arestas são por LINHA (parent → child); a
personalização é por VIEW. Guardar configuração de view na aresta multiplicaria
o dado por linha e misturaria dois eixos que não têm relação. A mesma coluna
pode ser larga numa view e estreita em outra — largura é apresentação, e por
isso mora na view, não na coluna (ver `types.ts` da lib `cubs-database`).

**Custo aceito: referência pendurada.** Como o snapshot cita ids de coluna,
deletar uma coluna deixa rastro em `orderedHeaderCols` e `columnWidths` — e
**essa limpeza não existe hoje** (`deleteColumn` só remove a linha de
`page_columns`). O custo é contido de propósito:

- **Leitura tolera:** `reorderByIds` da lib ignora ids desconhecidos e joga
  itens fora da lista para o fim. Coluna morta no snapshot **não quebra a UI** —
  vira lixo acumulado, não corrupção. Verificado em 2026-07-19.
- **Durante a escrita:** não ressuscitar id morto; podar
  oportunisticamente é suficiente, já que a gravação reescreve o objeto inteiro.

⚠️ **Separado disso, e mais sério:** deletar coluna também deixa os VALORES
órfãos em `page_columns_values` (nenhuma FK tem `ON DELETE CASCADE`). Isso não é
efeito do snapshot — é do backend — e está registrado em
[NEXT_STEPS.md](../NEXT_STEPS.md) §8.

### Invariantes

- **Chave = ULID da view**, e ela é a identidade da tab. Gerar ULID novo a cada
  render troca a view ativa do usuário a cada refetch.
- **`page_title` é coluna sintética**, não uma `page_columns`. O id é
  propositalmente não-ULID (`TITLE_COLUMN_ID`, com `_` e 10 chars) para nunca
  colidir com coluna real e ser reconhecível dentro de `orderedHeaderCols`.
- A coluna sintética carrega **`key: "title"`**: essa é a ligação imutável
  com `pages.title`. O `title.column_name` do snapshot é apenas o rótulo da
  coluna naquela view; renomeá-lo não altera os títulos das páginas. Seu tipo é
  sempre `text` e não pode ser trocado; `title.mask` continua configurável e
  também é por view. Snapshots antigos sem `title` recebem a prévia padrão em
  memória e passam a persistir a identidade na próxima personalização.
- **Leitura é tolerante:** `parseViewSettings` descarta em silêncio qualquer
  entrada de `data` que não tenha cara de view. `data` é campo livre — o app
  pode guardar outras coisas ali, e elas não devem virar tab quebrada.
- **`filters` é sempre `ViewFiltersV2` em memória e na escrita nova.** O backend
  valida ids de coluna/option, condição e acesso; remove referências que
  desapareceram antes do write e nunca aceita `updatedAt` do cliente. Filtros
  diferentes combinam com AND, valores de select dentro da mesma cláusula com
  OR e `groupBy` preserva a prioridade. Regras por tipo continuam registradas
  em `mappedFilters`, sem `switch` espalhado na UI.
- **Identidade persistida e URL têm fronteiras diferentes.** O snapshot guarda
  ULIDs de view, coluna e option. A URL nunca os expõe: usa public keys
  normalizadas e legíveis (`NFKD`, sem acentos, lowercase, `_`) e aliases:

  ```text
  ?view=docentes&fv=2&group=area_de_atuacao&f.nome.contains=Ana&f.area_de_atuacao.equals=computacao
  ```

  `group` pode repetir e sua ordem é a prioridade; cláusulas repetidas usam
  `f1`, `f2`, ...; valores múltiplos repetem a mesma key. `fv=2` sem critérios
  significa limpar explicitamente. Parâmetros fora do namespace são
  preservados. Alias antigo é aceito e canonicalizado com navegação `replace`;
  key desconhecida/ambígua nunca aponta silenciosamente para a primeira
  entidade.
- `urlKey` identifica a view; `page_columns.data.publicKey` identifica coluna
  real; cada option mantém sua `publicKey`; a coluna sintética usa
  `title.publicKey`. Renomear promove a key anterior para `aliases`. Keys e
  aliases são reservados no escopo para que link antigo nunca seja reciclado.
- Strings v1 e metadata ausente continuam legíveis. O parser as promove em
  memória e agenda uma única chamada idempotente a
  `POST /pages/:id/filter-keys/reconcile`, que repara keys/aliases, converte o
  documento e poda referências mortas numa transação rqlite. Isso usa somente
  os JSON existentes: **não há migration de tabela**.
- A URL explícita continua soberana. Se divergir do padrão persistido, a modal
  pergunta se deve substituí-lo; “Não” preserva o banco. Alterações locais
  atualizam o namespace da URL numa única navegação e persistem filtros/grupos
  juntos.

### Estado da implementação

| Ponta | Situação |
|---|---|
| Formato | ✅ definido e estável |
| Leitura (backend → UI) | ✅ `parseViewSettings` / `parseDatabase` em `src/lib/databaseParser.ts` |
| Fallback sem view salva | ✅ `createFallbackViewSettings` (uma tab `table` com todas as colunas) |
| **Escrita de personalização (UI → backend)** | ✅ `PATCH /pages/:id/views/:viewId` |
| **Filtros e agrupamentos** | ✅ `PUT /pages/:id/views/:viewId/filters` (atômico, timestamp server-side) |
| **Upgrade legado/public keys** | ✅ `POST /pages/:id/filter-keys/reconcile` (idempotente, sem migration) |

O seed cria páginas com `data: {}`. A leitura monta uma view fallback estável;
na primeira personalização, o app a materializa com ULID real e grava o
snapshot completo uma única vez. Depois disso, usa as rotas atômicas por view.

### Persistência e concorrência

- **`FALLBACK_VIEW_ID`** (`01KXVZ0000FALLBACKTABLE001`) é sentinela de cliente e
  nunca é persistida. A primeira alteração de ordem/largura materializa a view
  com ULID real, troca a chave no estado otimista e só então envia o snapshot.
- **Concorrência da view:** o patch atualiza somente caminhos JSON da view e
  preserva as demais. Assim, uma largura não sobrescreve filtros que chegaram
  concorrentemente pelo endpoint dedicado.
- **Coalescência de filtros:** estado local é imediato; a persistência usa
  debounce trailing de 250 ms por view, no máximo uma request em voo e uma
  versão final pendente. Estados intermediários são substituídos. Trocar de
  página/view força flush; falha antiga nunca reverte uma edição mais nova.

---

## 3. Rotas que o frontend consome

As rotas de dados exigem `Authorization: Bearer <access token>`. As de sessão
usam o **cookie** de refresh — ver o quadro de auth abaixo.

| Rota | Papel no fluxo | Consumidor |
|---|---|---|
| `POST /api/auth/login` | `{ user, accessToken }` + cookie de refresh | `AuthService` |
| `POST /api/auth/register` | cria conta + workspace privada; `{ user, workspace, accessToken }` | `SignUpPage` |
| `POST /api/auth/workspace-key/preview` | valida chave `create` pública e devolve nome/e-mail para autocomplete, sem consumir | `WorkspaceSignUpPage` |
| `POST /api/auth/register/workspace` | cria conta + primeira workspace com chave em uma transação | `WorkspaceSignUpPage` |
| `POST /api/auth/refresh` | novo access token (cookie → cookie) | `ApiService` |
| `POST /api/auth/logout` | revoga a sessão, limpa o cookie | `AuthService.signOut` |
| `GET /api/auth/me` | o usuário do token (sustenta o guard) | `AuthService.restore` |
| `GET /api/workspaces` | lista workspaces + role + `pageRootId` do usuário | `WorkspaceSelectorPage` |
| `POST /api/workspaces/access-keys/validate` | valida chave/identidade/finalidade sem consumir | `WorkspaceAccessPage` |
| `POST /api/workspaces` | cria workspace com `{ name, key, organizationId? }`; criador vira `superadmin` | `WorkspaceAccessPage` |
| `POST /api/workspaces/join` | consome `{ key }`, cria membership `member` e root própria | `WorkspaceAccessPage` |
| `GET /api/organizations` | lista organizações + role + quantidade de workspaces do usuário | `OrganizationManagement` em `/workspaces` |
| `POST /api/organizations` | cria organização e vincula sua primeira workspace individual | `OrganizationManagement` |
| `PUT /api/organizations/:id/workspaces/:workspaceId` | vincula outra workspace; exige `superadmin` dos dois lados | `OrganizationManagement` |
| `GET /api/organizations/:id/workspaces/:workspaceId/users?q=` | busca todos os usuários; prefixo antes de ocorrência; devolve roles atuais | `OrganizationManagement` |
| `POST /api/organizations/:id/workspaces/:workspaceId/users/:userId` | adiciona como `member` da organização e da workspace e cria sua root | `OrganizationManagement` |
| `GET /api/workspaces/:id` | lê workspace somente para member/superadmin | `WorkspaceSettingsLayout` |
| `PUT /api/workspaces/:id` | altera `{ name, icon }` somente como `superadmin` | `WorkspaceGeneralSettingsPage` |
| `GET /api/workspaces/:id/page_root` | resolve o ponto de entrada da membership; não cria | `getEntryPage` |
| `GET /api/workspaces/:id/members` | lista usuários e roles somente como `superadmin` | `WorkspaceMembersPage` |
| `PUT /api/workspaces/:id/members/:userId/role` | troca `superadmin`/`member` | `WorkspaceMembersPage` |
| `GET /api/pages/:id` | a página; `data` traz o **snapshot** | `getPage` → `settings` |
| `GET /api/pages/:id/collaborators` | vínculos `{ id, name, email }` | `PageShell` / configurações da página |
| `GET /api/pages/:id/collaborator-candidates?q=` | candidatos limitados à workspace dona da árvore | configurações da página |
| `POST /api/pages/:id/collaborators` | adiciona em lote, recusando usuários fora da workspace atual | configurações da página |
| `GET /api/pages/parent/:id/columns` | definição das colunas | `getColumns` → `headerCols` |
| `GET /api/pages/:id/page` | filhas + valores (as linhas) | `getChildren` → `rows` |
| `PUT /api/pages/parent/:id/columns/:cid` | config da coluna (name/type/options/**format/currency/mask**) | menu de coluna |
| `POST /api/pages/parent/:id/columns/:cid/reset` | "reset de tipos" (zera o `data`, reseta células divergentes) | `onColumnReset` |

Rotas de configuração de workspace usam duas camadas da mesma matriz CASL. A
UI redireciona role insuficiente para `/$lang/access-denied`, e a API continua
sendo autoritativa: responde **403** com o envelope exato
`{ "message": "Acesso não permitido" }`. Usuário sem membership recebe 404,
evitando confirmar a existência de uma workspace privada.

### Modelo de workspaces, memberships e chaves

`organizations` é a entidade opcional de agrupamento, em relação 1:N com
`workspaces`; `workspaces.organization_id = NULL` representa
uma área individual. `organization_members` controla quem administra o
agrupamento. A criação recebe uma primeira workspace individual em que o usuário
já é `superadmin`; o criador vira `superadmin` da organização. Workspaces
adicionais recebem `organizationId` na criação ou são vinculadas explicitamente
por alguém que seja `superadmin` da organização e da workspace. Uma segunda
workspace criada pelo mesmo usuário não pode permanecer individual. O seed IFC
vincula suas várias áreas à mesma organização.
O ícone da workspace é um id global estável `cuida:<nome>` ou
`lucide:<nome>`; o prefixo identifica a biblioteca e não faz parte do rótulo
mostrado pelo picker. Frontend e API usam as mesmas versões dos catálogos e a
API rejeita nomes que não existam neles, não apenas prefixos inválidos.

`workspace_members` materializa o acesso com unicidade por
`(workspace_id, user_id)` e guarda:

- `role`: `superadmin` ou `member`;
- `page_root_id`: página inicial específica daquele usuário;
- timestamps do vínculo.

O criador preserva a compatibilidade histórica:
`workspace_members.page_root_id == workspaces.id == pages.id`, com a página
pertencendo ao criador. Cada usuário admitido depois recebe uma nova página com
ULID próprio e `pages.owner_id` igual ao member. Assim, todos compartilham a
workspace e suas configurações, mas `GET /workspaces/:id/page_root` devolve a
root ligada à membership autenticada sem colisão de PK e sem mutação em GET.

A matriz é simples: `member` pode ler `Workspace` e `WorkspaceRoot`;
`superadmin` acrescenta `manage` sobre `WorkspaceSettings` e
`WorkspaceMembers`. Um `member` não alcança a rota de roles e, portanto, não
pode promover a si mesmo. A troca de role não pode eliminar o último
superadmin; a proteção está no mesmo `UPDATE` condicional que altera a role.

A aba **Organização** de `/$lang/workspaces` escolhe explicitamente
`{ organização, workspace atual }`. Somente quem é `superadmin` nos dois
escopos pode buscar e admitir usuários. A pesquisa usa `LIKE` parametrizado,
escapa `%`, `_` e `\`, lista correspondências de nome/e-mail que começam pelo
texto antes das que apenas o contêm e nunca expõe `password_hash`. A admissão
cria `organization_members.role = member`, `workspace_members.role = member` e
a `page_root_id` própria do usuário. O picker de ícones mistura Cuida e Lucide
em uma lista alfabética; o prefixo da biblioteca continua apenas no valor
persistido, não na interface.

`workspace_access_keys` é a base auditável da credencial. O segredo tem prefixo
e versão (`cubs_ws_v1_...`), 192 bits aleatórios e aparece uma única vez no
terminal; no banco ficam somente SHA-256, hint, `algorithm_version`
(`sha256-v1`), nome/e-mail do destinatário, finalidade (`create` ou `join`),
expiração de 7 dias, consumo e revogação. `issued_to_name`/`issued_to_email`
permanecem imutáveis; no consumo, `consumed_as_name`/`consumed_as_email` e
`consumed_by_user_id` registram a identidade efetivamente criada ou usada.
Cada chave só pode ser consumida uma vez. Chaves `join` apontam para a workspace exclusivamente pela tabela
`workspace_access_key_links`; chaves `create` não têm vínculo prévio.

Há dois consumos de chave `create`. Para um usuário já autenticado, a validação
continua exigindo que nome/e-mail normalizados correspondam ao destinatário.
Para um usuário novo, `POST /auth/workspace-key/preview` responde sempre 200
com `{ valid: false }` ou `{ valid: true, name, email }`, usa rate limit próprio
e `Cache-Control: no-store`. O multiform pode corrigir os dados; o submit
revalida a chave e cria usuário, workspace individual (`organization_id =
NULL`), root, membership `superadmin`, vínculo e consumo numa única transação.
Uma conta já existente responde 409 e nunca recebe a workspace pela posse da
chave.

Emissão em desenvolvimento:

```bash
npm run workspace:key:create -- --name "Nome" --email usuario@exemplo.com --purpose create
npm run workspace:key:create -- --name "Nome" --email usuario@exemplo.com --purpose join --workspace <ULID>
```

Para produção, troque o script por `workspace:key:create:prod`. Sem flags, o
comando pergunta interativamente as credenciais, finalidade e workspace quando
necessário.

O cadastro comum não usa chave: ele cria, na mesma transação do usuário, uma
workspace privada chamada `Area de Trabalho do <primeiro nome>`, com root de
mesmo id e membership `superadmin`, e entra diretamente nela. A landing também
oferece `/$lang/create-workspaces`, multiform público chave → conta → workspace;
a chave permanece só em memória e nunca vai para URL ou `localStorage`.

No frontend, o login segue para `/$lang/workspaces`. A seleção centralizada
lista somente workspaces autorizadas e contém também a aba de Organização;
`/$lang/workspaces/new?tab=create|join`
abriga os formulários RHF; configurações full-screen são rotas filhas
`/$lang/workspaces/$workspaceId/settings/general` e `/members`. A opção de abrir
direto persiste via `clientStorage` como `{ userId, workspaceId }`: é escopada
pela conta, só vale se o id ainda vier de `GET /workspaces` e é ignorada quando
`?choose=true` exige seleção explícita.

### Config de coluna (`page_columns.data`) e troca de tipo

`data` ACUMULA o config de vários tipos: `options` (select), `format`+`currency`
(numeric), `mask` (text). Trocar o tipo é **não-destrutivo** — o `buildData`
MESCLA (preserva o config do tipo antigo) e faz **whitelist** (chave desconhecida
não persiste; no PUT, `null` numa chave a LIMPA). A limpeza total é só o
`/reset`: volta o `data` à base do tipo e sobrescreve as células cujo valor não
valida mais (numeric→0, checkbox→false, text→"", select/date→vazio). `mask` e
`currency` são novos no `data`; hoje só a moeda BRL e as máscaras cpf/cep/
phone-br/date. Ver `page-column-controller.mergeData`/`resetColumn`.

### Auth por cookie (o refresh não trafega no corpo)

O par JWT vai para lugares diferentes de propósito: o **refresh** (7d) só existe
como cookie `HttpOnly` (JS não lê → XSS não exfiltra); o **access** (15min) vai
no corpo e mora em MEMÓRIA no frontend (some no reload). A sessão sobrevive ao
F5 pelo cookie, via `restore()` (`/auth/refresh` → `/auth/me`).

- **Escrita sempre por HTTP** já valia para a base; agora vale para a sessão
  também — o cookie é a única credencial persistida, e ela é do servidor.
- `refresh`/`logout` exigem o header `X-Cubs-Client` (guarda de CSRF;
  `SameSite=Lax` já fecha o vetor, o header é a segunda camada). Sem ele: 403.
- `logout` **revoga de verdade** (incrementa `users.token_version`): um refresh
  vazado morre no logout, não só quando expira.
- Política do cookie por ambiente (dev `cubs_rt` sem Secure; prod
  `__Host-cubs_rt` com Secure) é fonte única em `core/auth/cookie.config.ts`.
- Como testar isso no Insomnia (o refresh saiu do corpo): `docs/INSOMNIA.md`.

`loadPage(pageId)` dispara as três leituras em paralelo e passa por
`parseDatabase`. `loadWorkspace` é só `getEntryPage` seguido de `loadPage`.

**Por que as colunas não saem do dataset:** o JOIN de `/pages/:id/page` parte dos
VALORES, então coluna recém-criada — ainda sem nenhum valor — não apareceria.
`/columns` é a fonte da verdade dos headers; o dataset entra só com os valores.

### Modelo recursivo (premissa que o frontend assume)

Não existe tipo especial de página "raiz". `page_edges` liga parent → child, e
QUALQUER página pode ser parent. Uma base/tabela é só uma página cujas **filhas**
são as linhas — o mesmo id é filha num nível e parent no seguinte. Por isso todas
as rotas acima aceitam o id de qualquer página, e descer para uma filha é a mesma
chamada com outro id.

A workspace resolve **só o ponto de entrada da membership**. O criador mantém
`workspaces.id == pages.id`; membros posteriores usam o `page_root_id` ULID
próprio. "Root" é convenção falada, não estado da página nem coluna.

`pages` e `page_columns` usam `deleted_at` nullable como tombstone. O
`SoftDeleteSolution` do `Model` troca o `DELETE` físico por timestamp do banco e
escopa leituras/updates para `deleted_at IS NULL`; arestas, valores e public keys
permanecem preservados para uma futura restauração. As rotas de exclusão
continuam sendo `DELETE`, mas publicam realtime somente depois do soft delete
confirmado pelo rqlite.

### Realtime v1 (contrato cross-repo)

A escrita é exclusivamente HTTP. Depois que o controller/rqlite confirma, a
rota chama um método semântico de `PageRealtimePublisher`; Socket.IO apenas
propaga o fato para `page-database:{pageId}`. Falha de broadcast é logada e não
transforma uma escrita persistida em falso erro HTTP.

O wire canônico é
[`src/core/socket/realtime-contract-v1.ts`](../src/core/socket/realtime-contract-v1.ts),
sem imports internos. O frontend consome uma cópia gerada em
`src/services/realtime-contract-v1.ts`. Sincronize e confira a partir do
backend:

```bash
npm run realtime:contract:sync
npm run realtime:contract:check
```

Roteamento dos fatos duráveis:

| Mutação confirmada | Audiência/evento |
|---|---|
| valor criado, alterado ou limpo | parent da linha → `cell-updated` |
| `pages.title` como linha | parent → `row-updated` |
| `pages.title` como página aberta | própria página → `page-updated` |
| definição completa de coluna real | página dona → `column-updated` |
| patch de view, filtros/grupos ou reconcile de `pages.data` | própria página → `view-updated` |
| linha criada/excluída | parent → `row-created` / `row-deleted` |
| coluna criada (definição completa) | página dona → `column-created` |
| coluna excluída | página dona → `column-deleted` |

`column-resizing` é efêmero, específico por `viewId` e não ecoa ao autor. O
resize final usa PATCH da view e chega no snapshot durável. Owner e collaborator têm a mesma
audiência; estranho recebe `page-database-denied`. O autor recebe o próprio eco
durável para selar o relógio do servidor.

No frontend, `PageRealtimeChannel` concentra join/leave/listeners e
`usePageDatabase` continua sendo o estado canônico `ParsedDatabase`. Criação de
linha/coluna e exclusão de linha/coluna entram por merge incremental idempotente,
sem desmontar nem piscar a base. ACKs que exigem snapshot continuam usando
resync coalescido. Reconexão sempre exige novo join e refetch somente depois de
`joined-page-database`.

Nenhum nome do protocolo depende de table, board ou calendar. Valor, título da
linha e metadata de coluna real são globais; nome/máscara da coluna sintética,
ordens, filtros e larguras continuam dentro do snapshot por view.

Criação/entrada em workspace, alteração de nome/ícone e troca de role não fazem
parte do realtime v1: são operações HTTP e não publicam eventos Socket.IO.

---

## 4. Status por peça

| Peça | Status |
|---|---|
| Auth (refresh em cookie HttpOnly, access em memória, logout revoga) | ✅ |
| Prefixo `/api` ponta a ponta | ✅ verificado dev (Vite) e prod (nginx) |
| Leitura de base (workspace → página → filhas → UI) | ✅ |
| Snapshot: formato + leitura | ✅ |
| Snapshot: escrita pelo app | ✅ (ordem de linhas/colunas e largura) |
| Edição de colunas/valores pela UI | ✅ HTTP otimista + eco pós-commit |
| Workspace selecionável + preferência por usuário | ✅ listagem real; sem mock/default fixo |
| Criação/entrada por chave auditável | ✅ validação de identidade + consumo single-use |
| Roles e configurações de workspace | ✅ CASL no frontend e na API; painel só `superadmin` |
| Realtime v1 (socket.io) | ✅ modular, contrato gerado, resync e smoke multi-cliente |
| Permissões / `page_users` | 📋 só brainstorm (NEXT_STEPS) |

---

## 5. Armadilhas conhecidas

Coisas que já custaram tempo de depuração; itens resolvidos continuam aqui para
que o contrato antigo não seja reintroduzido.

### 5.1 Token sobrevive ao usuário → 404 enganoso

O middleware ([middleware.ts](../src/core/auth/middleware.ts)) valida **só
assinatura e expiração** do JWT; nunca confere se o usuário ainda existe. Depois
de um `npm run seed` que recria a tabela `users`, o token guardado no browser
aponta para um id fantasma e **continua passando pela autenticação**.

O sintoma é confuso: `GET /workspaces/:id/page_root` responde **404
"Workspace não encontrado"** porque não existe membership para o id fantasma.
O fluxo atual não tenta mais criar root durante esse GET.

**Sintoma diagnóstico:** a mesma URL funciona no Insomnia (token novo) e falha no
browser (token velho). Se a resposta muda com o token, o problema é de sessão —
não de rota nem de proxy. Um 404 de proxy nunca chega no SQL.

**Solução:** logout e login de novo. (A sessão não mora mais no `localStorage`
— é o cookie de refresh + o access em memória. Um "hard reload" não basta,
porque o cookie válido restaura o mesmo token fantasma; o logout REVOGA. Se
precisar forçar pela mão, apague o cookie `cubs_rt` no devtools e recarregue.)

### 5.2 Colisão antiga de `page_root` resolvida por membership

O problema antigo foi resolvido por `workspace_members.page_root_id`. A raiz do
criador ainda usa o id da workspace; cada segundo usuário recebe um ULID de
página diferente, com `owner_id` próprio. `page_root` agora é leitura do vínculo
e nunca tenta inserir uma página durante um GET.

### 5.3 Role escondida na UI não é autorização

O frontend usa a mesma matriz CASL para não renderizar o painel e encaminhar
`member` para a tela de acesso negado. Isso é somente comportamento de UI. As
rotas `PUT /workspaces/:id`, `GET /workspaces/:id/members` e
`PUT /workspaces/:id/members/:userId/role` repetem a checagem no backend e
retornam o mesmo 403 `{ message }`; nunca confie só na ausência de um link.
