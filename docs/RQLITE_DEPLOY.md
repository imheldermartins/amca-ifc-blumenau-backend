# Deploy de produção com autenticação do rqlite

Execute os comandos Linux no Ubuntu WSL, na raiz do backend. O Docker é o Engine
do Ubuntu; o script não depende de Node instalado no WSL. O projeto Compose é
`docker`, perfil `edge`. Os quatro containers existentes devem estar em execução;
backend e rqlite devem estar saudáveis.

## Credenciais e primeiro deploy

`docker/rqlite.prod.env` é a única fonte dos usuários e senhas do banco. Os arquivos
reais não entram no Git. Copie os exemplos apenas na preparação inicial da stack,
sem sobrescrever arquivos existentes. O script preserva os demais parâmetros.

| Variável | Conta / valor |
| --- | --- |
| `RQLITE_USERNAME` | `cubs_user` |
| `RQLITE_PASSWORD` | 64 caracteres hexadecimais, gerados no bootstrap |
| `RQLITE_READER_USERNAME` | `cubs_reader` |
| `RQLITE_READER_PASSWORD` | Outra senha independente de 64 caracteres |

`cubs_user` tem `query`, `execute`, `status`, `ready`, incluindo escrita SQL e DDL.
`cubs_reader` tem `query`, `status`, `ready`. As permissões abrangem o banco
inteiro, não são as roles de usuários do aplicativo. Nenhuma conta recebe `all`,
`backup`, `load`, `join` ou acesso anônimo. Status/ready aqui verificam o banco;
a prontidão da aplicação continua em `/health/ready` na API.

Antes do deploy, valide o código e o pacote publicado, faça commit e push:

```bash
bash scripts/deploy-prod.sh --bootstrap-auth --check all
bash scripts/deploy-prod.sh --bootstrap-auth all
```

O primeiro comando prepara os arquivos protegidos e valida o Compose sem trocar
serviços. O segundo constrói as imagens, consulta migrations, instala primeiro o
backend compatível com autenticação, para backend/rqlite e faz um backup
consistente do volume. Em seguida inicia o rqlite autenticado e o backend.
Existe uma breve indisponibilidade porque há um único nó. O volume existente
`docker_rqlite_data` é reutilizado, não recriado.

Senhas existentes são preservadas, inclusive quando `--bootstrap-auth` é repetido.
O rollout com essa flag exige que o nó atual ainda seja não autenticado; não é
um comando de rotação. `--check` e geração de arquivos podem ser repetidos.

O JSON e o arquivo curl do healthcheck ficam em `docker/.generated/`, montados
somente para leitura no rqlite. O backend recebe apenas a conta de escrita.
Em NTFS, o script aplica ACLs ao usuário Windows atual, SYSTEM e Administradores;
no Linux usa permissões locais restritas. Senhas não aparecem nos argumentos.
Não compartilhe o `.env` inteiro: ele contém as duas contas.

## Atualizações e operação

```bash
bash scripts/deploy-prod.sh backend
bash scripts/deploy-prod.sh frontend
bash scripts/deploy-prod.sh all
```

Requer trabalho versionado e enviado ao upstream. Escolha o menor alvo. O
frontend não é reconstruído num deploy apenas do backend. O banco só é recriado
no bootstrap; alterações posteriores em sua imagem/configuração ou credenciais
exigem novo rollout coordenado. O script não faz rotação automática.

O script exige `pending: []`; não aplica automaticamente migrations pendentes
nem passa `--allow-manual`/`--allow-destructive`. O entrypoint continua idempotente
quando todas já estão aplicadas. Para diagnóstico manual, inclua o env de
interpolação em todas as chamadas Compose:

```bash
docker compose -p docker --env-file docker/rqlite.prod.env \
  -f docker/docker-compose.prod.yml --profile edge run --rm --no-deps \
  --entrypoint /app/node_modules/.bin/rqlite backend migrate status \
  --config /app/dist/rqlite.config.js --environment production
```

Cada deploy guarda IDs anteriores e tags `cubs-<serviço>:rollback-<UTC>` em um
relatório protegido. O bootstrap também retém uma imagem `auth-compatible` do
backend e um backup frio do volume. Nunca volte ao backend antigo sem suporte
a autenticação depois de proteger o banco. Uma falha interrompe o script sem
retirar a autenticação ou restaurar volumes automaticamente. Primeiro consulte
o relatório e a saúde dos containers e corrija a etapa que falhou; restauração
de dados é uma operação separada. Não execute `down -v` nem descarte backups.

O Windows e o Ubuntu WSL precisam continuar ligados. O script não cria tarefas
de inicialização do Windows nem altera DNS ou políticas Cloudflare.

## Dataflare por HTTPS, nesta máquina ou em outra

O acesso escolhido usa o Tunnel existente, sem contratar ou ativar Zero Trust.
O `cloudflared` no Docker/WSL conecta o servidor à Cloudflare. Não é necessário
instalar ou manter `cloudflared` no Windows para esta forma de conexão.

```text
Dataflare -- HTTPS :443 --> db.cubsonline.com.br / Cloudflare
                                      |
                              Tunnel existente
                                      |
                            HTTP rqlite:4001
                            com Basic Auth
```

Configuração no painel do túnel `cubsonline-wsl-prod`:

| Parâmetro | Valor |
| --- | --- |
| Tipo de rota | Published application |
| Subdomain | db |
| Domain | cubsonline.com.br |
| Path | vazio (todos os caminhos) |
| Service URL | http://rqlite:4001 |

O fluxo de criação da rota configura o DNS automaticamente. Preserve as rotas
existentes do site e da API. O serviço de origem usa HTTP na rede Docker; o
cliente usa HTTPS com validação normal do certificado da Cloudflare.
Não configure `https://rqlite:4001`, pois o nó interno não oferece TLS.

Na zona, a regra `Require HTTPS for rqlite` usa apenas o padrão
`http://db.cubsonline.com.br/*` e redireciona para
`https://db.cubsonline.com.br/${1}` com status 308 e preservação da query string.
Ela mantém o método HTTP, inclusive POST, e não altera os demais hostnames.
Configure o cliente já com HTTPS: o redirecionamento não protege credenciais
que um cliente tenha enviado por HTTP antes de receber a resposta.

Essa publicação torna a API SQL do banco alcançável pela internet, exigindo
as credenciais próprias do rqlite. É a opção escolhida pelo proprietário para
conexão direta, sem uma segunda autenticação no navegador. Quem possui a conta
de escrita pode ler e modificar o banco inteiro. Não compartilhe as duas senhas
nem reutilize a senha de uma conta do aplicativo.

No Dataflare, selecione o driver de rqlite e preencha:

| Campo | Valor |
| --- | --- |
| Name | Cubs produção (ou outro nome local) |
| Protocol | HTTPS |
| Host | db.cubsonline.com.br |
| Port | 443 |
| User | cubs_user para edição; cubs_reader para consultas |
| Password | RQLITE_PASSWORD ou RQLITE_READER_PASSWORD, respectivamente |

As senhas estão somente no arquivo local protegido `docker/rqlite.prod.env`.
O campo Host não inclui `https://`, caminho nem porta. Não use a porta externa
4001, `127.0.0.1` ou um proxy TCP local neste modelo. As portas 4001/4002 do
Docker permanecem sem publicação no host e o volume de dados é preservado.
Se havia um `cloudflared access tcp` aberto no Windows, ele não participa dessa
conexão e pode ser encerrado com Ctrl+C no terminal correspondente.

A conta de leitura deve usar `/db/query`; `/db/request` exige também `execute`,
mesmo para SELECT. Se o driver de uma versão do Dataflare usar esse endpoint
para consultas, use um cliente com endpoint de leitura; não amplie as permissões
do reader para contornar a rejeição. A conta `cubs_user` pode usar os dois.

### Verificação e diagnóstico

1. Confira que a rota e o registro DNS foram salvos no painel do túnel.
2. No PowerShell, `Resolve-DnsName db.cubsonline.com.br` precisa resolver.
3. Uma requisição sem credenciais a `https://db.cubsonline.com.br/readyz` deve
   retornar HTTP 401. Senha inválida também deve ser recusada. Não envie senhas
   por HTTP nem desative a validação de TLS no Dataflare.
4. Com cada perfil, teste consulta, `/status` e `/readyz`. Valide a escrita de
   `cubs_user` com um UPDATE sem linhas correspondentes e a recusa de escrita
   de `cubs_reader`. Nenhuma verificação precisa modificar dados existentes.
5. Confirme que site, API e Socket.IO continuam funcionando.

Publicação verificada em 27/10/2026: rota e CNAME criados no túnel existente;
TLS válido; acesso anônimo e senha inválida recusados; os dois perfis consultam
e acessam status/ready; writer executa UPDATE sem linhas afetadas e reader tem
escrita recusada. HTTP GET/POST redirecionam com 308, preservando caminho e
query. Site, prontidão da API e handshake Socket.IO responderam HTTP 200.
Nenhum container ou volume precisou ser recriado nessa publicação.

- `lookup ... no such host` significa que o DNS ainda não resolve; mudar usuário
  ou senha não corrige esse erro. Confira a existência do registro e eventual
  cache negativo do resolvedor local.
- HTTP 502 indica falha entre o túnel e a origem. Confira serviço `rqlite:4001`,
  saúde do container e rede Docker; não exponha portas como tentativa de correção.
- HTTP 401 indica credenciais ausentes ou inválidas, ou rejeição de um endpoint
  sem a permissão necessária. Confira o perfil e a senha correspondente.
- HTTP 403 pode ser recusa do perfil ou uma regra na borda; confira a origem da
  resposta antes de alterar permissões.
- Uma tela de login Access seria outra configuração. O fluxo escolhido não
  exige ativação de Zero Trust, cartão, sessão Access nem listener no Windows.

### Alternativa futura: Cloudflare Access

Se o proprietário optar depois por uma segunda camada de acesso, planeje uma
migração separada. O modo TCP com Access exige aplicação/política, rota TCP e
`cloudflared access tcp` na máquina cliente. O modo HTTPS com Access exige que
o cliente também autentique nessa camada. Não habilite login interativo sobre
esta rota presumindo compatibilidade automática com o driver do Dataflare.

Referências: [rqlite Security](https://rqlite.io/docs/guides/security/) e
[Cloudflare: protocolos para aplicações publicadas](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/).
