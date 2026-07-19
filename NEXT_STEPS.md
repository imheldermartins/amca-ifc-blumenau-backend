# Próximos passos — Cub's

Roadmap de curto prazo dos dois projetos (`cubs-backend` e `cubs-frontend`).
Marque os itens conforme forem concluídos.

> **Status (2026-07-13):** itens 1, 3, 4 e 5 executados e verificados. Restam
> o basic auth opcional do rqlite (1.2) e o bloco de realtime (2, futuro
> supervisionado). ⚠️ Descoberto no caminho: o SQLBuilder não escapa `'` em
> strings (quebra + injection) — sinalizado como tarefa separada.

> **Status (2026-07-19):** prefixo `/api` passou a ser REAL nos dois lados
> (antes era invenção do mediador) e a leitura de base funciona ponta a ponta:
> workspace → página de entrada → filhas → `<CubsDatabase />`. O **snapshot**
> (personalização por view em `pages.data`) tem formato e leitura prontos, mas
> **escrita ainda não implementada no app**. Contrato completo, status por peça
> e armadilhas conhecidas: **[docs/INTEGRACAO.md](docs/INTEGRACAO.md)**.
> ⚠️ Duas descobertas registradas lá (§5): token sobrevive ao usuário após o
> seed (404 enganoso) e `page_root` só existe para um dono por workspace.

> **Padrão de portas:** frontend **:80** (nginx, prod) / **:5173** (Vite, dev);
> backend **:3000** (dev e prod); rqlite **:8000→4001** (dev, só no host
> permitido) / sem porta publicada (prod, rede interna do compose).

---

## 1. Segurança: rate limit no backend + restrição de host no rqlite

### 1.1 Limite de requisições (backend) — ✅ FEITO

- [x] `express-rate-limit` global em [http-server.ts](src/core/http/http-server.ts),
      configurado em [rate-limit.config.ts](src/core/http/rate-limit.config.ts):
      300 req/min por IP (ajustável via `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`).
- [x] Limite agressivo no `/auth` (login/register/refresh): 20 tentativas por
      15 min por IP (`AUTH_RATE_LIMIT_*`), aplicado no próprio
      [auth-router.ts](src/core/auth/auth-router.ts).
- [x] Resposta `429` no formato `{ message }` padrão do projeto; headers
      `RateLimit-*` (draft-8) informam a cota ao client.
- [x] `TRUST_PROXY=1` (env) para o IP real atravessar o nginx em prod — sem
      isso o limite valeria para todos os usuários juntos.
- Testado: 21ª tentativa de login na janela → `429`; rotas normais intactas.
- ⚠️ Estado em memória por instância: com múltiplas instâncias do backend,
  trocar por store compartilhado (mesmo momento do adapter Redis do socket).

### 1.2 Restrição de host no rqlite — ✅ config feita, falta rebuild (1.3)

- [x] **Bind do Docker:** [docker-compose.dev.yml](docker/docker-compose.dev.yml)
      publica as portas só em `${RQLITE_ALLOWED_HOST:-127.0.0.1}` — outra
      máquina recebe *connection refused*. Para cluster/outro host, defina
      `RQLITE_ALLOWED_HOST` (ex.: `0.0.0.0` ou IP da interface).
- [x] **Prod sem porta:** no [docker-compose.prod.yml](docker/docker-compose.prod.yml)
      o rqlite não publica porta nenhuma — só o backend alcança, via rede
      interna (`http://rqlite:4001`).
- [x] **CORS do rqlite:** `RQLITE_HTTP_ALLOW_ORIGIN` (env) vira
      `-http-allow-origin` no [entrypoint.sh](docker/rqlite/entrypoint.sh).
      É valor **único** — o header `Access-Control-Allow-Origin` do padrão
      CORS não aceita lista. E CORS só instrui browsers; a restrição real é o
      bind acima.
- [ ] (Opcional) **basic auth** do rqlite (`-auth` + arquivo de credenciais) —
      doc oficial "Securing rqlite". O backend passaria as credenciais no
      `sendRequest` de [shared.ts](src/core/db/shared.ts).

### 1.3 Rebuild limpo e teste — ✅ FEITO (2026-07-13)

- [x] `down -v` + remoção da imagem antiga + `up -d --build` com o compose dev.
- [x] `docker port` confirma bind só em `127.0.0.1` (8000 e 4002);
      `curl http://127.0.0.1:8000/status` → 200.
- [x] De outra interface da máquina (172.x): **connection refused** — a porta
      nem responde fora do host permitido.
- [x] `npm run migrate` no volume novo: as 3 migrations aplicaram em cadeia
      (setup cria `page_hubs` → rename para `page_edges`).

---

## 2. Realtime (socket.io) — 🔭 TAREFA FUTURA (executar só com supervisão)

**Decisão:** este bloco NÃO deve ser implementado de forma autônoma — precisa
de acompanhamento próximo quando chegar a hora. Fica aqui como referência.

A base já existe: [socket-server.ts](src/core/socket/socket-server.ts) pega
carona no mesmo `http.Server` do express, exige JWT no handshake e tem os
eventos demo `presence:count` e `echo:send/reply`. O contrato de eventos é
espelhado em `cubs-frontend/src/services/SocketService.ts` — **todo evento
novo precisa ser atualizado nos dois lados**.

Ideias registradas:

- Rooms por `page_root` (join ao abrir a página; broadcasts só para a room).
- Eventos de CRUD (`column:created`, `value:updated`, `page:deleted`...) após
  as rotas de [page-route.ts](src/routes/page-route.ts), com payload no mesmo
  formato decodificado do HTTP.
- Permissões nos handlers quando `page_users` existir (viewer recebe, mas
  escrita é rejeitada no servidor).
- Reconexão: re-join das rooms + refetch de sincronização.
- Presença por página (evoluir o `presence:count` global).
- Escala: adapter Redis quando houver mais de uma instância.
- Rate limit de eventos socket (o middleware HTTP do item 1.1 não cobre ws).

---

## 3. Popular base de dados (seed IFC) — ✅ FEITO (2026-07-13)

- [x] [seed.ts](src/core/scripts/seed.ts) + `npm run seed` — **idempotente**
      (2ª execução: 0 criados, 365 já existiam).
- [x] **Professores como `users` (dados públicos):** 26 do IFC Blumenau
      (informatica.blumenau.ifc.edu.br/corpo-docente) e 23 do IFC Videira
      (videira.ifc.edu.br/ciencia-da-computacao/corpo-docente), com emails
      institucionais reais. + 1 admin fictício (`admin@cubs.local`).
- [x] **Senha documentada em `.env.seed`** (fora do git): todos os usuários
      seed logam com ela — login testado via API (dev e via nginx em prod).
- [x] **Workspaces/páginas por uso:** "IFC Blumenau — Professores",
      "IFC Videira — Professores", "IFC — Turmas" (alunos por turma, sem dados
      pessoais de aluno — não são públicos como os contatos institucionais dos
      docentes) e "Fábrica de Software" (projetos) — cobrindo os 5 tipos de
      coluna. Totais: 50 users, 4 workspaces, 61 pages, 57 edges, 14 columns,
      179 values. Dataset conferido via `GET /pages/:id/page`.
- ⚠️ Bug pré-existente descoberto: o SQLBuilder não escapa `'` (nomes como
  "Cub's" quebram INSERT/WHERE — vetor de injection). Sinalizado como tarefa
  separada; o seed evita apóstrofos por enquanto.

---

## 4. Docker (nginx :80 frontend, :3000 backend) — ✅ config feita, falta build/teste

- [x] **Backend:** [Dockerfile](Dockerfile) na raiz (node:24-alpine, roda via
      tsx — o tsc não reescreve os path aliases `@/...`, então `node dist/`
      quebraria). Envs pelo compose, porta 3000.
- [x] **Frontend:** `cubs-frontend/Dockerfile` multi-stage (build Vite →
      nginx:alpine na porta 80). `.dockerignore` impede o `.env` local de
      vazar `VITE_CUBS_API_URL` para o bundle de prod.
- [x] **nginx:** `cubs-frontend/nginx/nginx.conf` — SPA fallback, `/api/` →
      `backend:3000` **preservando o prefixo** (`proxy_pass` sem barra final,
      igual ao proxy do Vite), `/socket.io/` com upgrade de WebSocket,
      `X-Forwarded-For` para o rate limit.
      ⚠️ Atualizado em 2026-07-19: até então o nginx e o Vite REMOVIAM o `/api`
      porque o backend servia na raiz. Ver [docs/INTEGRACAO.md](docs/INTEGRACAO.md) §1.
- [x] **Compose dev/prod separados:**
      [docker-compose.dev.yml](docker/docker-compose.dev.yml) (só rqlite) e
      [docker-compose.prod.yml](docker/docker-compose.prod.yml) (rqlite +
      backend + frontend; requer `cubs-frontend` clonado ao lado).
- [x] **Envs separados:** `.env.development` / `.env.production` no backend
      (templates `.example` no git), `docker/backend.prod.env` /
      `docker/rqlite.prod.env` (templates `.example` no git),
      `.env.development` / `.env.production` no frontend.
- [x] **Build e teste end-to-end (2026-07-13):** `.prod.env` locais
      preenchidos (JWT gerados com openssl; NÃO commitados), stack completa
      buildada e validada: site :80 (200), login de professor seedado via
      nginx `/api` (JWT ok), handshake socket.io via nginx (upgrade websocket
      disponível), backend :3000 (401 sem token) e rqlite **inalcançável** do
      host. Obs.: o build expôs um erro de tipo no frontend
      (`Button.tsx` sem `shadow` do `PaletteEntry`) — corrigido lá.
      Prod foi derrubada após o teste; dev restaurada com os dados do seed
      (volume compartilhado entre os dois compose).

---

## 5. Verificar CLAUDE.md nos dois projetos — ✅ FEITO (2026-07-13)

- [x] **cubs-backend:** [CLAUDE.md](CLAUDE.md) criado (fica fora do git — o
      `.gitignore` o ignora): camadas, regra "SQL só em core/db" + `db.sqlRaw`,
      premissas do modelo (page_root == workspace, `page_edges`, codecs),
      migrations append-only, envs dev/prod, avisos (bug do `'`, rate limit em
      memória, senha do seed).
- [x] **cubs-frontend:** revisado — atualizada a seção de arquitetura (backend
      :5000 → :3000, proxy do Vite em dev / nginx em prod).

---

## 6. Log interativo frontend×backend — ⏳ A FAZER

Padrão de observabilidade: **toda ação** (request do frontend → tratamento no
backend → resposta) fica registrada dos dois lados e **correlacionada por um
id**, para que, se algo cair, os logs "declarem tudo". Correlação por
`X-Request-Id` (ULID) gerado no frontend e ecoado pelo backend.

- [ ] **Backend — correlation id + middleware de log:** no `HttpServer` (antes
      das rotas), lê/gera `X-Request-Id`, loga início e fim de cada request em
      JSON estruturado (id, método, path, status, duração ms, `userId`) e
      devolve o id no header.
- [ ] **Backend — persistir logs:** além do stdout, gravar em arquivo num
      volume do compose (sobrevive a restart) com rotação — é o "se cair, ter
      tudo".
- [ ] **Frontend — interceptor axios:** em `src/lib/connection.ts`, gera/propaga
      o `X-Request-Id`, mede duração e loga request + response/erro num ring
      buffer em memória (casa com o log do backend pelo id).
- [ ] **Frontend — painel de log interativo:** overlay toggável com o stream ao
      vivo das ações (método, path, status, duração, id), filtrável e com
      detalhe por item.
- [ ] **Socket no mesmo rastro (FUTURO, supervisionado):** integrar eventos
      socket.io ao mesmo id/stream — depende do trabalho de realtime (§2), que
      não deve ser mexido sem supervisão.

---

## 7. Escrita do snapshot (personalização por view) — ⏳ A FAZER

O **snapshot** é o padrão de personalização por view guardado em `pages.data` —
definição canônica em [docs/INTEGRACAO.md](docs/INTEGRACAO.md) §2. Formato e
leitura estão prontos; falta o caminho de volta.

- [ ] **Frontend — read-modify-write:** `PUT /pages/:id` substitui `data`
      INTEIRO. Salvar uma view exige reenviar todas as outras, senão elas somem.
      Esse é o ponto que mais convida a bug.
- [ ] **Decidir o `FALLBACK_VIEW_ID`:** sentinela de cliente
      (`01KXVZ0000FALLBACKTABLE001`) que hoje nunca é persistida — e não é ULID
      válido (Crockford exclui `I L O U`). Materializar com ULID real na 1ª
      gravação, ou filtrar antes de enviar.
- [ ] **(Opcional) Rota dedicada por view** — evitaria o read-modify-write e a
      sobrescrita entre clientes. Avaliar junto do realtime (§2).
- [ ] **Workspace selecionável:** hoje `FIXED_WORKSPACE_ID` está fixo no
      `DatabaseService` do frontend. Nada mais no código assume workspace única.

---

## 8. Robustez de sessão e acesso — ⏳ A FAZER

Descobertos depurando um 404 em 2026-07-19 (detalhes em
[docs/INTEGRACAO.md](docs/INTEGRACAO.md) §5).

- [ ] **Token sobrevive ao usuário:** o middleware valida só assinatura e
      expiração — depois de um `npm run seed` que recria `users`, o token do
      browser aponta para id fantasma e continua passando. Conferir existência
      (no middleware, ou só no `refresh`, mais barato) e devolver 401.
- [ ] **`page_root` de um dono só:** busca por `(id, owner_id)` mas cria com
      `pages.id` = id da workspace (PK) — segundo usuário colide e recebe 404.
      **Decisão de produto pendente:** workspace compartilhada (tirar `owner_id`
      do lookup) ou page_root por usuário (quebra `workspaces.id == pages.id`,
      exige migration). Ligado ao `page_users` abaixo.
- [ ] **Erro honesto:** a colisão de PK vira "Workspace não encontrado" (404).
      Um 409 com mensagem própria apontaria a causa direto.
- [ ] **Autorização inconsistente:** `/pages/:id` filtra por `owner_id`, mas
      `/pages/:id/page` e `/pages/parent/:id/columns` não filtram nada. Alinhar
      junto com a decisão acima.
- [ ] **Deletar coluna deixa valores órfãos:** `deleteColumn` só remove a linha
      de `page_columns`; os `page_columns_values` daquela coluna ficam no banco
      apontando para um id morto — nenhuma FK tem `ON DELETE CASCADE`.
      Reproduzido em 2026-07-19. Resolver no controller (apagar os valores junto)
      ou na migration (recriar a FK com cascade — lembrando que o SQLite só
      aplica FK com `PRAGMA foreign_keys = ON` na conexão).
      Obs.: o rastro que a MESMA operação deixa no snapshot é benigno (a leitura
      ignora id desconhecido) — ver [docs/INTEGRACAO.md](docs/INTEGRACAO.md) §2.

---

## 📋 Brainstorm (não executar ainda): `page_users`

Registro da ideia para não perder — **nada disso foi criado**:

- Tabela `page_users` relacionando `user_id` × `page_id` (ou `page_root_id`?)
  com uma **role**.
- Premissa original: booleano de admin — admin da página **edita**, não-admin
  só **visualiza**.
- Ponto em aberto: booleano `is_admin` vs. campo `role TEXT` enumerável
  (`admin | editor | viewer`...). O booleano resolve o hoje; o enum evita uma
  migration futura se surgir um terceiro nível — decidir antes de criar.
- Impactos quando sair do papel: middleware de permissão nas rotas de páginas,
  validação nos handlers do socket (item 2), searchbar do frontend filtrando
  páginas que o usuário pode ver.
