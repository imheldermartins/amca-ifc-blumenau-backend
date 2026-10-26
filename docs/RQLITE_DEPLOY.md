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

## Dataflare de outra máquina: Cloudflare Access

Configuração única, feita pelo proprietário no painel Cloudflare:

1. Em Zero Trust, crie uma aplicação Access Self-hosted para
   `db.cubsonline.com.br`, sessão de oito horas.
2. Selecione o login por código de e-mail ou seu provedor já configurado e crie
   uma política Allow contendo somente os e-mails exatos autorizados. Não use
   bypass ou autorização para todos. Crie essa proteção antes da rota.
3. No túnel existente, acrescente uma rota TCP para esse hostname, com destino
   `tcp://rqlite:4001`, preservando as rotas existentes do site/API. Crie o
   registro DNS apontando para o mesmo túnel pelo fluxo do painel.
4. Confirme o bloqueio de uma identidade fora da lista. Não abra 4001 ou 4002 no
   roteador, firewall ou Compose. O segmento interno permanece na rede Docker.

Instale `cloudflared` pelo distribuidor oficial na máquina que executa o Dataflare:

```bash
cloudflared access tcp --hostname db.cubsonline.com.br --url 127.0.0.1:14001
```

Mantenha esse processo aberto. Ao conectar, conclua a autenticação Access no
navegador. No Dataflare, configure:

| Campo | Valor |
| --- | --- |
| Protocol | HTTP |
| Host | 127.0.0.1 |
| Port | 14001 |
| User | cubs_reader para consultas, cubs_user para edição |
| Password | Senha correspondente, obtida localmente pelo proprietário |

O endereço local usa HTTP, mas o tráfego remoto atravessa o túnel criptografado.
Não use `cubsonline.com.br:4001`. Access e a senha do banco são duas verificações
independentes. A conta de leitura deve usar `/db/query`; `/db/request` exige
também `execute`, mesmo para SELECT. Se o driver de uma versão do Dataflare usar
esse endpoint para consultas, documente a incompatibilidade e utilize um cliente
com endpoint de leitura; não amplie as permissões para contornar a rejeição.

Referências: [rqlite Security](https://rqlite.io/docs/guides/security/) e
[Cloudflare TCP](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/).
