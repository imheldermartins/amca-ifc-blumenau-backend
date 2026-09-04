# ADR 0001 — Realtime v1 modular, orientado à página e agnóstico à view

- Status: aceito e implementado
- Data: 2026-08-30
- Escopo: `cubs-backend` + `cubs-frontend`

## Contexto

O protocolo realtime já usava Socket.IO e a room `page-database:{pageId}`, mas
autorização, presença, interações e broadcasts duráveis estavam concentrados em
um único serviço. Além de dificultar testes e evolução, as rotas HTTP conheciam
nomes de eventos, rooms e montagem de payloads.

A mesma página pode ser renderizada por diferentes views. Valor de célula,
título de linha e definição de coluna real são estado global da base; filtros,
ordem, largura e a apresentação da coluna sintética `page.title` pertencem ao
snapshot de uma view. O transporte não pode depender de nomes como tabela,
quadro ou calendário.

## Decisão

O realtime v1 mantém um único protocolo e uma única room por página. Toda
escrita continua passando por HTTP e rqlite; Socket.IO publica apenas fatos já
confirmados. A implantação suportada é deliberadamente single-instance.

```text
UI de qualquer view
  → mutação HTTP
  → controller/rqlite confirma
  → PageRealtimePublisher
  → PageEditChannel
  → page-database:{pageId}
  → PageRealtimeChannel no cliente
  → reducers do ParsedDatabase
  → qualquer renderer da página
```

Não há evento, room ou classe nomeada por tipo de view. `viewId` aparece apenas
no resize efêmero e dentro do snapshot, onde a apresentação é de fato específica.

## Composição do backend

O diretório `src/core/socket/` contém responsabilidades independentes:

- `RealtimeChannel`: contrato de id, eventos client/server, `attach` e
  `register`.
- `RealtimeChannelRegistry`: valida ids, ownership duplicado e cobertura
  integral do inventário v1 no boot; cada socket é registrado uma única vez.
- `SocketServer`: cria o Socket.IO, valida o JWT do handshake e entrega a
  conexão autenticada ao registry.
- `PageRoomChannel`: join/leave, `canAccessPage`, ACK/negação, presença e
  cleanup de disconnect.
- `PageInteractionChannel`: resize efêmero, somente para membros da room e sem
  eco ao autor.
- `PageEditChannel`: único emissor dos fatos duráveis de página.
- `SystemChannel`: compatibilidade global de `presence:count` e echo.
- `RealtimeEventFactory`: única origem de `updatedAt`; `originUserId` chega do
  usuário autenticado da request.
- `PageRealtimePublisher`: API sem imports de Socket.IO usada pelas rotas após
  o commit. Resolve a parent de células, escolhe a página de audiência e
  registra falhas de broadcast sem converter um commit em erro HTTP.

O antigo `realtime-service.ts` foi removido; não existe fachada paralela.

## Contrato v1

A fonte canônica e portátil é
`src/core/socket/realtime-contract-v1.ts`. Ela não possui imports internos. A
cópia gerada do frontend fica em
`../cubs-frontend/src/services/realtime-contract-v1.ts`.

Comandos executados a partir do backend:

```bash
npm run realtime:contract:sync
npm run realtime:contract:check
```

`check` compara os arquivos byte a byte e falha se nomes, direções, payloads ou
inventários divergirem.

### Client → server

| Evento | Channel | Função |
|---|---|---|
| `echo:send` | system | diagnóstico v1 |
| `join-page-database` | page-room | entrar na room autorizada |
| `leave-page-database` | page-room | sair da room |
| `resize-column` | page-interaction | preview efêmero por `viewId` |

### Server → client

| Evento | Channel | Durável |
|---|---|---|
| `presence:count` | system | não |
| `echo:reply` | system | não |
| `joined-page-database` | page-room | não |
| `page-database-denied` | page-room | não |
| `page-presence` | page-room | não |
| `column-resizing` | page-interaction | não |
| `cell-updated` | page-edit | sim |
| `row-updated` | page-edit | sim |
| `page-updated` | page-edit | sim |
| `column-updated` | page-edit | sim |
| `view-updated` | page-edit | sim |
| `row-created` / `row-deleted` | page-edit | sim |
| `column-created` / `column-deleted` | page-edit | sim |

Eventos duráveis carregam `pageId`, `updatedAt` e `originUserId`. O autor recebe
o próprio eco: ele confirma o estado otimista e sela o relógio do servidor.

## Roteamento de mutações

| Commit confirmado | Room e evento | Aplicação no cliente |
|---|---|---|
| POST/PUT/DELETE de valor | parent da linha → `cell-updated` | grava a célula; `null` remove |
| `pages.title` | parent → `row-updated` | atualiza a coluna sintética da linha |
| `pages.title` | própria página → `page-updated` | atualiza o chrome de `PageShell` |
| definição de coluna real | página dona → `column-updated` | substitui o header inteiro |
| patch de view, filtros/grupos ou reconcile de `pages.data` | própria página → `view-updated` | substitui o snapshot recebido; filtros remotos ficam pendentes até “Atualizar” |
| criação/exclusão de linha | parent → `row-created/deleted` | merge incremental idempotente |
| criação de coluna | página dona → `column-created` com definição completa | merge incremental do header, sem values nem refetch |
| exclusão de coluna | página dona → `column-deleted` | agenda resync estrutural em background |
| resize em andamento | página → `column-resizing` | preview por `viewId`, sem eco |
| resize final | PATCH atômico da view → `view-updated` | snapshot remove o preview |

Na exclusão de página, a parent é capturada antes do DELETE e o evento só é
publicado depois do sucesso. O reset de coluna publica a coluna e cada célula
com um único timestamp, preservando os defaults efetivamente persistidos:
`false`, `0`, `""` ou `null`.

## Estado e clocks no frontend

`SocketService` cuida apenas da conexão, autenticação, reconexão e contagem de
consumidores. `PageRealtimeChannel` cuida de membership, listeners, filtro por
`pageId`, cleanup e preview. `usePageRealtime` é uma adaptação React fina.

`usePageDatabase` continua sendo a fonte única de `ParsedDatabase`. O redutor
puro registra um handler por evento durável de dados. Célula, título de linha,
coluna e snapshot têm relógios independentes; `PageShell` mantém o relógio de
`page-updated`. Evento estritamente mais velho é descartado. Empates são
aceitos porque a implantação single-instance preserva a ordem de emissão do
Socket.IO.

Eventos estruturais e ACKs usam resync coalescido: existe no máximo uma leitura
em voo e uma passagem subsequente pendente. Respostas de página/revisão antigas
não substituem estado novo.

Regras preservadas:

- valor, título da linha e metadata de coluna real são globais à base;
- `page_columns.data.mask` viaja na definição completa de `column-updated`;
- nome/máscara da coluna sintética vivem em cada snapshot e viajam por
  `view-updated`;
- ordem, filtros, larguras e previews continuam específicos por `viewId`;
- um renderer futuro recebe `rows`, `headerCols`, `settings` e handlers; ele
  não abre socket nem registra channel.

## Falhas e recuperação

- Falha antes do commit: resposta HTTP de erro e nenhuma publicação.
- Falha de broadcast depois do commit: log `[cubs:realtime]`; a resposta HTTP
  continua refletindo o sucesso persistido.
- Queda de conexão: a membership desaparece. Ao reconectar, o cliente faz novo
  join e só ressincroniza após `joined-page-database`.
- Não existe replay/outbox no v1; o refetch é a recuperação autoritativa.

## Como registrar uma evolução

1. Defina o evento e payload no contrato canônico, mantendo compatibilidade do
   v1 quando possível.
2. Declare exatamente um channel como owner em `clientEvents` ou
   `serverEvents`; o registry deve continuar cobrindo todo o inventário.
3. Implemente o handler/emissor no channel. Eventos de domínio não entram em
   `SocketServer`.
4. Para commits HTTP, exponha um método semântico no publisher e chame-o apenas
   depois do controller confirmar a escrita.
5. Rode `npm run realtime:contract:sync` e adapte o handler registrado no
   `PageRealtimeChannel`/redutor, sem condicionar ao tipo de view.
6. Cubra autorização, room, eco, clocks, cleanup e recuperação nos testes.
7. Rode todos os gates dos dois repositórios e
   `npm run realtime:contract:check`.

## Limites deliberados e rollback

Não pertencem ao v1 suportado: Redis, múltiplas instâncias, replay/outbox e a
implementação visual de novas views. O adapter Socket.IO e os rate limits em
memória são corretos enquanto o backend tiver uma instância. Escalar
horizontalmente exigirá uma nova decisão arquitetural coordenada.

Não houve migration nem dependência runtime nova. O único pacote adicionado é
`socket.io-client` como devDependency do backend para o teste com clientes
reais. O rollback é exclusivamente de código.
