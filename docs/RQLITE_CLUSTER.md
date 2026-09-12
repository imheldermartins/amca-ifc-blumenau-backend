# Cluster rqlite entre WSL e Termux

Este perfil executa um node por host. O notebook inicia o cluster e o Termux
entra como replica `non-voter`, simulando distancia geografica sem fazer a
disponibilidade de escrita depender da bateria ou da rede do celular.

> Dois voters nao oferecem tolerancia a falha: o quorum seria 2 e a queda do
> celular impediria novas escritas. Para failover real, use pelo menos tres
> voters estaveis. O Termux como non-voter replica todo o banco, atende leituras
> e encaminha escritas ao leader, mas nao participa de eleicoes.

## Tres enderecos, tres responsabilidades

| Configuracao | Formato | Responsabilidade |
| --- | --- | --- |
| `RQLITE_URL` | `http(s)://host:porta` | API HTTP que o backend consome |
| `RQLITE_HTTP_ADV_ADDR` | `host:porta` | API HTTP deste node anunciada ao cluster |
| `RQLITE_RAFT_ADV_ADDR` | `host:porta` | Raft deste node anunciado aos peers |
| `RQLITE_JOIN_ADDRS` | `host:porta[,host:porta]` | Raft de um ou mais nodes existentes usados no primeiro join |

`RQLITE_JOIN_ADDRS` nao recebe a URL HTTP do leader. O node que entra envia ao
cluster os seus proprios enderecos anunciados; o leader passa a usa-los para
voltar ao novo node. Por isso o caminho precisa funcionar nos dois sentidos.

CORS nao participa desse processo. `RQLITE_HTTP_ALLOW_ORIGIN` apenas controla o
header que browsers verificam ao chamar a API HTTP. A autorizacao peer-to-peer
deve ser feita pela ACL do Tailscale ou por TLS/mTLS quando a rede for publica.

## Preparacao comum

No notebook:

```bash
cd /home/h3/amca-ifc-blumenau-backend
cp docker/rqlite.leader.env.example docker/rqlite.node.env
```

No Termux, dentro do clone do mesmo repositorio:

```bash
cp docker/rqlite.joined.env.example docker/rqlite.node.env
```

Revise os IPs, nomes, portas e paths do arquivo real. Ele fica fora do Git.
Cada `RQLITE_NODE_ID` deve ser unico e permanente para aquele volume.

Subida, igual nos dois hosts:

```bash
docker compose \
  --env-file docker/rqlite.node.env \
  -p amca-rqlite \
  -f docker/docker-compose.rqlite-cluster.yml \
  up -d --build
```

O nome do projeto pode ser igual nos dois hosts, pois cada daemon Docker e
independente. O `container_name` e o volume continuam especificos de cada host.

Nunca tente juntar dois bancos independentes esperando merge. O node joined
deve usar volume novo ou descartavel: ao entrar, ele recebe o estado do cluster
iniciado no notebook.

## Opcao A: Tailscale privado

Esta e a opcao recomendada para o teste. O transporte do Tailscale ja e
criptografado, os IPs sao estaveis dentro da tailnet e o Raft nao fica exposto
na internet.

Snapshot observado em 2026-09-12 (confirme antes de subir):

- WSL: `100.98.198.19`
- Termux: `100.80.19.27`

Os templates usam host ports `8001` (HTTP) e `4003` (Raft), evitando conflito
com o rqlite local existente em `8000`/`4002`.

### Docker Desktop com Tailscale dentro do WSL

Mantenha `RQLITE_PUBLISH_HOST=127.0.0.1`. Depois de subir o container no WSL,
publique somente na tailnet, sem Funnel:

```bash
tailscale serve --bg --tcp=8001 tcp://127.0.0.1:8001
tailscale serve --bg --tcp=4003 tcp://127.0.0.1:4003
tailscale serve status
```

Repita no Termux se o `tailscale serve` estiver disponível no ambiente que
controla o IP Tailscale do Android.

Se o Termux nao conseguir usar Serve, teste `RQLITE_PUBLISH_HOST=0.0.0.0` e
confirme que o port-forward do Docker/Android aparece no IP Tailscale. Esse
fallback tambem pode expor a porta na LAN, portanto limite o acesso no firewall
e encerre-o depois do teste. `--network host` e um ultimo fallback e depende do
tipo de Docker/proot/VM usado pelo Termux.

### Matriz minima da ACL

A tailnet deve permitir exatamente:

| Origem | Destino | Porta | Motivo |
| --- | --- | --- | --- |
| WSL | Termux | TCP `4003` | Leader envia Raft para a replica |
| Termux | WSL | TCP `4003` | Join, snapshots e Raft |
| WSL | Termux | TCP `8001` | API anunciada/diagnostico |
| Termux | WSL | TCP `8001` | API anunciada/diagnostico |

Nao basta o Tailscale SSH funcionar. Ele nao prova que `4003` esteja liberada.

Antes de iniciar o joined node, no Termux:

```bash
tailscale ping 100.98.198.19
nc -vz 100.98.198.19 4003
curl --fail "http://100.98.198.19:8001/readyz"
```

No notebook, valide o caminho de volta:

```bash
tailscale ping 100.80.19.27
nc -vz 100.80.19.27 4003
curl --fail "http://100.80.19.27:8001/readyz"
```

No Android, mantenha o processo acordado durante o ensaio:

```bash
termux-wake-lock
```

## Opcao B: tunel TCP, incluindo ngrok

Use `RQLITE_NETWORK_MODE=tunnel`. Cada host precisa de dois endpoints TCP
independentes e bidirecionais:

1. endpoint TCP para HTTP interno -> `127.0.0.1:8001`;
2. endpoint Raft externo -> `127.0.0.1:4003`.

O leader anuncia os dois endpoints dele. O Termux anuncia os dois endpoints do
Termux e configura `RQLITE_JOIN_ADDRS` com o endpoint **Raft** do leader.
Se tambem houver um endpoint HTTPS com terminacao TLS do provedor, trate-o como
uma terceira URL voltada aos clientes; nao o anuncie como o endpoint HTTP cru
usado entre nodes.

Exemplo conceitual do leader:

```dotenv
RQLITE_NETWORK_MODE=tunnel
RQLITE_HTTP_ADV_ADDR=leader-http.tunnel.example:18001
RQLITE_RAFT_ADV_ADDR=leader-raft.tunnel.example:14003
RQLITE_JOIN_ADDRS=
```

Exemplo conceitual do Termux:

```dotenv
RQLITE_NETWORK_MODE=tunnel
RQLITE_HTTP_ADV_ADDR=termux-http.tunnel.example:28001
RQLITE_RAFT_ADV_ADDR=termux-raft.tunnel.example:24003
RQLITE_JOIN_ADDRS=leader-raft.tunnel.example:14003
```

Endpoints dinamicos mudam depois de reiniciar o tunel. Quando o endpoint Raft
de um node muda, atualize `RQLITE_RAFT_ADV_ADDR` e execute o join novamente com
o mesmo node ID. Endpoints reservados/estaveis evitam essa operacao.

### Seguranca obrigatoria em rede publica

O modo `tunnel` falha no boot sem `RQLITE_NODE_CERT` e `RQLITE_NODE_KEY`, salvo
se `RQLITE_ALLOW_INSECURE_TUNNEL=true` for explicitado para um teste descartavel.
Para mTLS, use em todos os nodes:

```dotenv
RQLITE_NODE_CERT=/run/rqlite-security/node.crt
RQLITE_NODE_KEY=/run/rqlite-security/node.key
RQLITE_NODE_CA_CERT=/run/rqlite-security/ca.crt
RQLITE_NODE_VERIFY_CLIENT=true
RQLITE_NODE_VERIFY_SERVER_NAME=rqlite-cluster
RQLITE_NODE_VERIFY_COMMON_NAME=rqlite-cluster
```

Os certificados devem vir da mesma CA e atender ao nome verificado. O diretorio
local `docker/rqlite/security` e montado read-only no container e ignora chaves.

Para Basic Auth da API, copie `auth.example.json` para `auth.json` em cada host,
troque as senhas e configure:

```dotenv
RQLITE_AUTH_FILE=/run/rqlite-security/auth.json
RQLITE_JOIN_AS=cluster-node
```

O backend aceita a API protegida com:

```dotenv
RQLITE_URL=https://host-ou-endpoint-http:porta
RQLITE_USERNAME=backend
RQLITE_PASSWORD=senha-do-auth-json
```

Um proxy HTTPS que termina TLS nao transforma o Raft em HTTPS. Raft continua
exigindo endpoint TCP e os enderecos anunciados nao levam `http://`, `https://`
ou `tcp://`.

## Validacao do cluster

Depois de subir o leader, confirme que ele anuncia os enderecos externos, nao
IP de container:

```bash
curl --fail "http://127.0.0.1:8001/nodes?nonvoters&pretty"
```

Depois de subir o Termux, a resposta deve conter:

- `amca-wsl-leader`: `leader: true`, `voter: true`, `reachable: true`;
- `amca-termux-replica`: `voter: false`, `reachable: true`.

Teste uma escrita no leader:

```bash
curl --fail -XPOST "http://127.0.0.1:8001/db/execute?pretty" \
  -H "Content-Type: application/json" \
  -d '["CREATE TABLE IF NOT EXISTS cluster_probe (id INTEGER PRIMARY KEY, source TEXT)", ["INSERT INTO cluster_probe(source) VALUES(?)", "wsl"]]'
```

E consulte localmente no Termux:

```bash
curl --fail -G "http://127.0.0.1:8001/db/query?pretty" \
  --data-urlencode "q=SELECT * FROM cluster_probe"
```

Para diagnostico:

```bash
docker compose --env-file docker/rqlite.node.env \
  -p amca-rqlite -f docker/docker-compose.rqlite-cluster.yml ps
docker logs amca-rqlite-wsl-leader
docker logs amca-rqlite-termux-replica
```

Para encerrar sem apagar o volume:

```bash
docker compose --env-file docker/rqlite.node.env \
  -p amca-rqlite -f docker/docker-compose.rqlite-cluster.yml down
tailscale serve reset
```
