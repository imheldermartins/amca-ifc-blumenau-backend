# Hosting do Cub's no Ubuntu do WSL2

Estado deste plano: infraestrutura local preparada; publicação do domínio
aguarda a criação do túnel Cloudflare e a migração revisada do DNS.

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
- Criado o exemplo `.wslconfig` em `docs/hosting-wsl/.wslconfig`. Ele ainda não
  foi aplicado ao Windows: copiar manualmente para `%UserProfile%\.wslconfig`.

## Capacidade do WSL

O computador tem 15,75 GiB de RAM e 4 processadores lógicos. A sugestão reserva
até 12 GiB e todos os 4 processadores ao WSL, com swap de 8 GiB e recuperação
gradual de cache. A recuperação gradual permite devolver cache ao Windows; o
limite de 12 GiB evita deixar o Windows sem memória. A alteração só vale após
encerrar/reabrir o WSL (`wsl --shutdown`); não executar enquanto houver trabalho
Linux que precise permanecer ativo.

## Domínio e email observados na Hostinger

Em 20/10/2026 o domínio estava ativo, com nameservers `atlas.dns-parking.com` e
`hyperion.dns-parking.com`. O apex `@` apontava para `2.57.91.91`; `www` era
CNAME para o apex. Não havia registro para `api`.

Antes de trocar os nameservers para Cloudflare, exportar e conferir a zona
completa. A tela mostrava estes registros de email Hostinger, que precisam ser
recriados como DNS only (nuvem cinza) para não interromper recebimento/envio:

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

Também havia o CNAME `www -> cubsonline.com.br`. A leitura visual não revela
todo registro auxiliar que possa existir: exportar a zona na Hostinger e
comparar antes do corte. A migração completa do DNS para Cloudflare requer
alterar nameservers no registrador; a leitura atual não fez essa alteração.

## Passos de publicação

1. Revisar os diretórios de backend e frontend. Ambos estão no branch `main`, mas
   têm alterações locais não commitadas. Há migrations de fórmula/relação no
   backend e mudanças de fórmula no frontend; não iniciar a produção desses
   diretórios sujos. Definir a revisão aprovada para publicação e preservar o
   trabalho local.
2. No Cloudflare, adicionar `cubsonline.com.br`, importar/revisar manualmente a
   zona Hostinger acima e conferir também qualquer registro não listado. Manter
   todos os registros de email como DNS only.
3. Criar um túnel remoto com nome `cubs-wsl-production`. Adicionar rotas públicas:
   `cubsonline.com.br -> http://frontend:80` e
   `api.cubsonline.com.br -> http://frontend:80`. Opcionalmente, apontar `www`
   para o frontend e configurar redirecionamento para o apex.
4. Copiar `docker/cloudflare.prod.env.example` para `docker/cloudflare.prod.env`
   e colar o token do túnel nesse arquivo local ignorado pelo Git. Não colocar o
   token em comandos, chat, commit ou documentação.
5. Conferir `docker/backend.prod.env`: `NODE_ENV=production`, `TRUST_PROXY=1`,
   `CORS_ORIGINS=https://cubsonline.com.br`, `APP_PUBLIC_URL=https://cubsonline.com.br`,
   `DATABASE_URL=http://rqlite:4001`, JWTs longos e SMTP copiado localmente.
   Confirmar no provedor que a conta SMTP ainda está ativa e autorizada para
   envio de produção. A configuração atual usa a porta e modo TLS já existentes.
6. O arquivo local `docker/rqlite.prod.env` foi criado para nó único `NODE_ID=1`
   e porta HTTP anunciada 4001. Não publicar essa porta na rede Windows/Internet.
7. Após selecionar fontes limpas/revisadas, validar a configuração e iniciar:

   ```powershell
   wsl -d Ubuntu
   cd /mnt/c/Projects/cubs-backend
   docker compose -f docker/docker-compose.prod.yml --profile edge config --quiet
   docker compose -f docker/docker-compose.prod.yml --profile edge up -d --build
   docker compose -f docker/docker-compose.prod.yml --profile edge ps
   ```

   O Compose executa as migrations compiladas no entrypoint do backend. Fazer
   backup do banco e revisar a lista de migrations antes do primeiro start.
8. No Cloudflare, deixar o TLS de visitante em HTTPS e o redirecionamento
   HTTP→HTTPS ativo. Confirmar `/health/ready` pelo host da API, login que
   persiste após refresh, chamadas `/api/v1` e transporte WebSocket de
   `socket.io`.
9. Só após validar site, API, login, realtime e email, trocar os nameservers na
   Hostinger pelos atribuídos pela Cloudflare. Depois confirmar delegação DNS,
   registros MX/SPF/DKIM/DMARC e HTTPS nos dois hosts.

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

## Situação ao fim da preparação

O Ubuntu e o Docker Engine nativo estão rodando; as envs de produção estão
preenchidas localmente sem versionar segredos. O stack da aplicação e o túnel
ainda não foram iniciados, porque o código-fonte está modificado localmente e a
zona/túnel Cloudflare ainda precisam ser criados e o DNS revisado. O domínio
continua servindo conforme a zona Hostinger existente. Nenhuma migration foi
aplicada por este procedimento.
