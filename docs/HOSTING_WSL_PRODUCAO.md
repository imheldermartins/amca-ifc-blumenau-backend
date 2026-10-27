# Hosting do Cub's no Ubuntu do WSL2

Operação atual do banco: [deploy autenticado e Dataflare](RQLITE_DEPLOY.md).
O rqlite usa credenciais próprias de leitura/escrita e somente leitura, mantidas
em `docker/rqlite.prod.env`. Os comandos Compose atuais precisam desse arquivo
de interpolação; prefira `scripts/deploy-prod.sh` para deploy. O acesso remoto
usa HTTPS em `db.cubsonline.com.br`, encaminhado pelo Tunnel ao rqlite privado
com Basic Auth. Não exige Zero Trust nem um listener no Windows. A porta
externa é 443; 4001 continua interna ao Docker. Consulte o guia para configurar
DNS/rota e verificar a publicação antes de conectar.
O registro abaixo descreve a preparação histórica de 21/10, não o estado atual
de publicação do site.

Estado em 2026-10-21: Ubuntu WSL2 com Docker Engine nativo está rodando; as 11
migrations pendentes foram aplicadas após autorização explícita, sem backup
conforme solicitado, e `pending: []`. rqlite, backend, frontend e o conector
Cloudflare Tunnel estão ativos; nginx serve o frontend e a prontidão HTTP da
API foi validada dentro da rede Docker. O volume persistente foi preservado.
O Tunnel `cubsonline-wsl-prod` está saudável. As rotas do apex e da API foram
salvas, e os CNAMEs proxied de `cubsonline.com.br` e `api.cubsonline.com.br`
apontam para esse Tunnel. A zona ainda está pendente porque os nameservers
autoritativos permanecem na Hostinger; a publicação pública ainda não está
ativa.

## Desenho

```text
Navegador
   │ HTTPS (Cloudflare Edge)
   ▼
Cloudflare Tunnel (conexão de saída; sem portas públicas na máquina)
   │ rede privada do Compose
   ▼
nginx/frontend :80 ── /api/v1 e /socket.io ──► backend :3000
   │ api.cubsonline.com.br encaminha todo o tráfego para o backend
   └─ cubsonline.com.br serve a aplicação SPA

backend :3000 ──► rqlite :4001 (somente rede interna do Compose)
```

O frontend é construído com `VITE_CUBS_API_URL=https://api.cubsonline.com.br/api/v1`;
o cliente Socket.IO deriva desse endereço a origem `https://api.cubsonline.com.br`
e conecta em `/socket.io`. O nginx aceita esse host e encaminha API e WebSocket
para o mesmo Express. O rqlite continua sem `ports` publicados.

## O que foi preparado

- Ubuntu 26.04.1 LTS no WSL2 já estava com `systemd=true` e usuário padrão `h3`.
- Instalados no Ubuntu `docker.io` e `docker-compose-v2`; usuário `h3` adicionado
  ao grupo `docker`; serviço Docker habilitado no systemd e ativo.
- Versões verificadas: Engine 29.1.3 e Compose 2.40.3.
- O Compose de produção agora tem um perfil opcional `edge` para o `cloudflared`
  fixado na imagem 2026.10.2, e o frontend/API recebem os hosts de produção.
- O nginx encaminha o IP enviado pelo Cloudflare em `CF-Connecting-IP` para o
  backend. `TRUST_PROXY=1` fica correto porque o nginx é o único proxy entre
  Tunnel e Express.
- O template de produção do backend declara origem, URL pública e limites atuais:
  300 req/min/IP global; autenticação 20/15 min; envio de formulários 30/15 min;
  leitura de formulário 120/min. Eles são por instância e este desenho usa uma.
- O arquivo local ignorado `docker/backend.prod.env` já recebeu a origem/URL
  pública, limites e as chaves SMTP existentes de `.env.development`; valores
  secretos não foram impressos nem adicionados ao Git. O env de rqlite single
  node também foi criado localmente.
- Criado o exemplo `.wslconfig` em `docs/hosting-wsl/.wslconfig`. O usuário o
  copiou manualmente para `%UserProfile%\.wslconfig`; a configuração efetiva foi
  confirmada após reiniciar o WSL.

## Segurança e build

- O Compose de produção valida com o perfil `edge`; as imagens de rqlite,
  backend e frontend foram construídas. O backend compilou, verificou o schema
  e a cadeia de migrations. O frontend passou
  TypeScript/Vite; o Vite avisa sobre um chunk `Editor` de ~758 kB e sobre
  `__dirname` no carregador de configuração planejado para versões futuras.
- Testes: backend 501 passaram/7 ignorados; frontend 732 passaram. Após mover
  o teste do placeholder para o ambiente React real, os 11 testes afetados
  passaram novamente.
- `npm audit --omit=dev` reporta zero vulnerabilidades nos dois runtimes. Ainda
  há advisories em ferramentas de build/teste: `braces` via `tsc-alias` no
  backend e `tinypool`/Vitest no frontend; estes pacotes não entram nas imagens
  finais. Não aplicar `npm audit fix --force` automaticamente.
- As imagens-base do frontend passaram a usar digests imutáveis; backend e
  rqlite já eram fixados. O nginx envia `X-Forwarded-Proto: https` no proxy
  Socket.IO. `nginx -t` passou e a imagem cloudflared 2026.10.2 foi baixada e
  verificada.

## Estado dos containers e migrations

- `cubs-rqlite` está saudável na rede privada; o volume `docker_rqlite_data`
  foi preservado. As portas 3000, 4001 e 80 não estão publicadas no host.
- No início do deploy havia 11 migrations pendentes: 5 `safe`, 4 `manual` e 2
  `destructive`. Após revisão, o usuário autorizou a aplicação, explicitamente
  sem backup e recriando os dados do zero. O volume foi mantido; as tabelas de
  aplicação estavam vazias antes da aplicação. A execução terminou com
  `pending: []` e o backend ficou saudável.
- O CLI não oferece rollback/recuperação automática. Em migrations futuras,
  revisar a fonte e as tabelas afetadas; não reutilizar esta autorização nem
  contornar os gates do CLI.

## Capacidade do WSL

O computador tem 15,75 GiB de RAM e 4 processadores lógicos. O arquivo
`%UserProfile%\.wslconfig` foi aplicado pelo usuário e confirmado após o
reinício do WSL: limite de 12 GB, 4 CPUs, swap de 8 GB e recuperação gradual de
cache. O Linux reporta aproximadamente 11 GiB de RAM e 8 GiB de swap. A
recuperação gradual devolve cache ao Windows, e o limite deixa memória para o
host.

## Firewall do Windows e Cloudflare Tunnel

O script foi executado em modo de auditoria, sem criar ou alterar regras. Em
21/10/2026, os perfis Domain, Private e Public do Windows Defender Firewall
estavam habilitados, com entrada padrão `Block` e saída `Allow`. O firewall
Hyper-V do WSL também estava habilitado com entrada `Block` e saída `Allow`.
Não é necessário desativar o Defender ou abrir portas de entrada para usar o
Tunnel. `cloudflared` estabelece conexões de saída em TCP/UDP 7844.

O script [Configure-WslCloudflareFirewall.ps1](Configure-WslCloudflareFirewall.ps1)
faz auditoria sem alterações por padrão. Se for executado com
`-AllowCloudflareTunnelEgress`, só cria exceções Hyper-V outbound para TCP e UDP
7844 caso a política efetiva de saída do WSL seja `Block`; com a configuração
observada agora, ele apenas informa que nenhuma exceção é necessária. Não muda
antivírus, perfis globais, política padrão ou regras inbound. Se a saída do WSL
estiver bloqueada por política explícita, para e pede revisão em vez de
contorná-la. A exceção opcional vale para todos os processos/distribuições WSL
e qualquer destino na porta remota 7844, portanto só deve ser usada quando
necessária e após conferir as regras existentes.

## Domínio e email observados na Hostinger

Verificação pública em 21/10/2026: nameservers `atlas.dns-parking.com` e
`hyperion.dns-parking.com`; o apex `@` aponta para `2.57.91.91`; `www` é CNAME
para o apex; `api.cubsonline.com.br` não tem A/CNAME. MX `mx1.hostinger.com`
(prioridade 5) e `mx2.hostinger.com` (prioridade 10) continuam publicados.
Também continuam resolvendo SPF no apex, DMARC `v=DMARC1; p=none`, os três
CNAMEs DKIM `hostingermail-a/b/c._domainkey` e `autodiscover`/`autoconfig` da
Hostinger.

Antes de trocar os nameservers para Cloudflare, revisar diretamente toda a lista
no hPanel e confirmar que os registros de email abaixo constam na zona Cloudflare
como DNS only (nuvem cinza), para não interromper recebimento/envio:

| Tipo | Nome | Conteúdo | Prioridade |
|---|---|---|---:|
| MX | @ | mx1.hostinger.com | 5 |
| MX | @ | mx2.hostinger.com | 10 |
| TXT | @ | `v=spf1 include:_spf.mail.hostinger.com ~all` | — |
| TXT | _dmarc | `v=DMARC1; p=none` | — |
| CNAME | hostingermail-a._domainkey | hostingermail-a.dkim.mail.hostinger.com | — |
| CNAME | hostingermail-b._domainkey | hostingermail-b.dkim.mail.hostinger.com | — |
| CNAME | hostingermail-c._domainkey | hostingermail-c.dkim.mail.hostinger.com | — |
| CNAME | autodiscover | autodiscover.mail.hostinger.com | — |
| CNAME | autoconfig | autoconfig.mail.hostinger.com | — |

Também havia o A `@ -> 2.57.91.91` e o CNAME `www -> cubsonline.com.br`; esses
destinos atuais da Hostinger não devem substituir as rotas do Tunnel. A migração
completa do DNS para Cloudflare requer alterar nameservers no registrador; a
leitura atual não fez essa alteração. O painel DNSSEC abriu somente o formulário
de cadastro, sem DS exibido; trate o estado como não confirmado e valide antes
do corte. Nenhum arquivo de zona foi exportado.

## Passos de publicação

1. O deploy local foi construído a partir do branch `main` nos dois repositórios,
   com alterações locais ainda sem commit. No backend, há alterações em
   `docs/HOSTING_WSL_PRODUCAO.md` e `package-lock.json`. No frontend, há
   alterações em `Dockerfile`, `nginx/nginx.conf`, `package.json`,
   `package-lock.json` e dois testes do editor. Os containers em execução usam
   essas árvores locais; revisar diffs e não descartá-los antes do próximo
   deploy.
2. A zona `cubsonline.com.br` já foi adicionada ao Cloudflare no plano Free e o
   assistente importou 11 registros (1 A, 6 CNAME, 2 MX, 2 TXT), correspondentes
   ao inventário observado na Hostinger. A rota Tunnel da API criou o 12º
   registro; a substituição do A do apex preservou o total. MX, SPF, DMARC, os
   três DKIM, autodiscover e autoconfig continuam DNS only. Antes da ativação,
   comparar o inventário DNS completo do hPanel com a zona.
3. Criados o Tunnel remoto `cubsonline-wsl-prod` e as rotas públicas
   `cubsonline.com.br -> http://frontend:80` e
   `api.cubsonline.com.br -> http://frontend:80`. O nginx decide entre frontend
   e API pelo Host. `www` continua com CNAME para o apex na zona Cloudflare.
4. O token do túnel está em `docker/cloudflare.prod.env`, ignorado pelo Git.
   Nunca imprimir, transmitir ou incluir o token em comandos, chat, commit ou
   documentação.
5. `docker/backend.prod.env` está configurado com `NODE_ENV=production`,
   `TRUST_PROXY=1`, `CORS_ORIGINS=https://cubsonline.com.br`,
   `APP_PUBLIC_URL=https://cubsonline.com.br`, `DATABASE_URL=http://rqlite:4001`,
   JWTs longos e as configurações SMTP locais existentes. O arquivo local do
   rqlite single-node anuncia a porta interna 4001. Nenhuma porta da aplicação
   ou do banco é publicada no host.
6. As validações de configuração e migrations executadas no Ubuntu foram:

   ```bash
   wsl -d Ubuntu
   cd /mnt/c/Projects/cubs-backend
   docker compose -f docker/docker-compose.prod.yml --profile edge config --quiet
   docker compose -f docker/docker-compose.prod.yml run --rm --no-deps --entrypoint /app/node_modules/.bin/rqlite backend migrate status --config /app/dist/rqlite.config.js --environment production
   ```

   As 11 migrations iniciais já foram aplicadas com autorização explícita e o
   estado confirmado foi `pending: []`. Os comandos abaixo são somente para
   migrations futuras, após revisar as fontes e obter autorização específica
   para os gates manual/destructive:

   ```bash
   docker compose -f docker/docker-compose.prod.yml run --rm --no-deps --entrypoint /app/node_modules/.bin/rqlite backend migrate --allow-manual --allow-destructive --config /app/dist/rqlite.config.js --environment production
   docker compose -f docker/docker-compose.prod.yml run --rm --no-deps --entrypoint /app/node_modules/.bin/rqlite backend migrate status --config /app/dist/rqlite.config.js --environment production
   ```

   Confirmar `pending: []` antes de iniciar os serviços. O stack de produção foi
   iniciado com:

   ```bash
   docker compose -f docker/docker-compose.prod.yml --profile edge up -d --build
   docker compose -f docker/docker-compose.prod.yml --profile edge ps
   ```

   O Compose também executa `rqlite check --database` no entrypoint. A prontidão
   `/health/ready`, chamadas `/api/v1` através do nginx e handshake polling do
   Socket.IO foram validados localmente. Login/email real em produção aguardam
   ativação do DNS e teste externo.
7. No Cloudflare, o A antigo do apex foi substituído, conforme autorização
   explícita, por CNAME proxied para o Tunnel
   `ba07e701-7e2f-4197-b1a1-d2a9c247c51b.cfargotunnel.com`. O CNAME proxied de
   `api` também está ligado ao mesmo Tunnel. MX, SPF, DMARC, DKIM,
   autodiscover e autoconfig da Hostinger continuam DNS only.
8. **Pendente:** revisar o inventário DNS completo e verificar DNSSEC no hPanel;
   depois, autorizar separadamente a troca dos nameservers na Hostinger pelos
   atribuídos pela Cloudflare. Só então confirmar delegação, HTTPS, API, login,
   realtime e email nos hosts públicos.

## Inicialização e limites operacionais

O serviço Docker inicia quando o Ubuntu inicia. Para o túnel permanecer online,
o Windows precisa estar ligado, conectado à internet e sem suspender; o host
doméstico não oferece continuidade durante desligamento, sono ou perda de rede.
O Tunnel exige conexões de saída para a Cloudflare (porta 7844 em UDP/QUIC ou
TCP/HTTP2); não abrir 3000, 4001 nem portas do roteador.

Rate limits Express e estado Socket.IO ficam na memória. Manter uma réplica do
backend. Aumentar réplicas exige store compartilhado de rate limit e adapter
Socket.IO. Não usar `docker compose down -v` em produção: isso remove o volume
persistente do rqlite.

## Situação atual

O Ubuntu está rodando em WSL2 com Docker Engine nativo (Docker Desktop parado).
O Linux reporta aproximadamente 11 GiB de RAM e 8 GiB de swap; `.wslconfig`
define 12 GB, 4 CPUs e `autoMemoryReclaim=gradual`. Os três serviços estão
ativos; `cubs-rqlite` e `cubs-backend` estão saudáveis. Foram verificados o HTML
do frontend, `/health/ready` com banco pronto, `/api/v1/auth/me` via nginx (401
esperado sem sessão) e handshake polling do Socket.IO (200). Migrations:
`pending: []`.

Confirmação ao vivo em 21/10/2026: o Ubuntu está `Running`; `cubs-backend` e
`cubs-rqlite` estão `healthy`, `cubs-frontend` está `Up`, e `cubs-cloudflared`
está conectado ao Tunnel. Docker Desktop está parado. A zona `cubsonline.com.br`
está criada no Cloudflare no plano Free, mas aguarda ativação. O import apresentou
os registros conhecidos da Hostinger; MX, SPF, DMARC, DKIM, autodiscover e
autoconfig continuam DNS only. O registro A antigo do apex foi substituído por
CNAME proxied para `ba07e701-7e2f-4197-b1a1-d2a9c247c51b.cfargotunnel.com`, e
`api` também tem CNAME proxied do Tunnel. `www` continua CNAME proxied para o
apex. O Tunnel `cubsonline-wsl-prod` tem rotas para `cubsonline.com.br` e
`api.cubsonline.com.br`, ambas para `http://frontend:80`; nginx escolhe o site e
proxy da API pelo Host. O Cloudflare atribuiu `emerson.ns.cloudflare.com` e
`sky.ns.cloudflare.com`; os nameservers autoritativos continuam
`atlas.dns-parking.com` e `hyperion.dns-parking.com`. As alterações na zona
Cloudflare ainda não afetam o DNS público enquanto a delegação não for trocada.
DNSSEC permanece não confirmado e deve ser verificado no hPanel antes do corte.

Verificação pública em 21/10/2026, após preparar a zona Cloudflare: os NS ainda
resolvem para Hostinger. `https://cubsonline.com.br` responde HTTP 200, porém o
HTML é a página estacionada da Hostinger (“Parked Domain name on Hostinger DNS
system”), não o Cub's. `api.cubsonline.com.br/health/ready` ainda não resolve.
O `nslookup` do Windows não suporta consulta DS nesta execução, então DNSSEC
continua sem confirmação. A troca de nameservers para `emerson.ns.cloudflare.com`
e `sky.ns.cloudflare.com` não foi executada: a automação do Chrome foi
interrompida por não conseguir identificar a URL da janela com segurança; não
houve alteração no registrador nesta tentativa.

Uma consulta DNS ao vivo ainda retorna os nameservers da Hostinger. Na zona
Cloudflare pendente, apex e `api` agora são CNAMEs proxied vinculados ao Tunnel;
o A antigo `2.57.91.91` foi removido da zona. Os registros de email Hostinger
continuam intactos e DNS only. O `cloudflared` está rodando em Docker Compose
com perfil `edge`; o token está somente em `docker/cloudflare.prod.env`,
ignorado pelo Git, e nunca deve aparecer no chat, em comandos, commits ou
documentação. A troca de nameservers na Hostinger continua pendente e requer
autorização separada; até lá, o tráfego público segue na configuração
autoritativa Hostinger. Depois da ativação, validar HTTPS, API, login, realtime
e email antes de considerar a publicação pública concluída.
