# Arquivos de seguranca do rqlite

Este diretorio e montado como `/run/rqlite-security` em modo somente leitura.
Coloque localmente aqui o arquivo de autorizacao e os certificados/chaves.
Somente este README e versionado; os demais arquivos sao ignorados.

Exemplos de caminhos dentro do container:

- `/run/rqlite-security/auth.json`
- `/run/rqlite-security/ca.crt`
- `/run/rqlite-security/node.crt`
- `/run/rqlite-security/node.key`

Para `RQLITE_NETWORK_MODE=tunnel`, TLS entre nodes e obrigatorio por padrao.
Copie `auth.example.json` para `auth.json`, troque as senhas e mantenha o mesmo
usuario `cluster-node` nos nodes que participam do join.
