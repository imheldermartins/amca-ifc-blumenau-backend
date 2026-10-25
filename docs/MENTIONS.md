# Menções e variáveis

`GET /mentions?pageId=...` fornece os usuários públicos (id, nome, email), a
página corrente e, se autorizadas, sua workspace e organização. Fora da página,
`workspaceId` ou `organizationId` definem o contexto. Com `pageId`, a workspace
é resolvida pela ancestralidade da página, nunca pela seleção do shell.

Os tipos públicos são `users.name/email`, `pages.title`, `pages.columns.<ULID>`,
`workspace.name/data.<chave>` e `organization.name/data.<chave>`.
Os campos livres suportam valores escalares; variáveis novas são somente texto.
O usuário autenticado é sempre a primeira pessoa do catálogo. Outros usuários
de uma página precisam pertencer ao conjunto que pode acessá-la.

`page.columns` do catálogo contém as propriedades escalares da página atual:
texto, número, checkbox, data e select (com o rótulo da opção). A consulta usa
a aresta com a página parent, exclui definições e páginas removidas e verifica
`page.read.view` para o leitor. Propriedades vazias continuam disponíveis.
Referências usam o ID da coluna e sobrevivem a renomeações; colunas removidas
ou sem acesso resolvem como `null`. A expansão e os limites de ciclos também
se aplicam às referências entre título e propriedades.

No frontend, `PageMentionProvider` recebe `{ id, title, columns }` e substitui
o escopo de página herdado, preservando pessoas e variáveis externas.
`RowMentionProvider` adapta `RowData` para esse contexto em Table, Board e Grid.
O editor exclui somente sua própria referência; o título exclui `pages.title`
da mesma página. Os valores locais acompanham a projeção/realtime da linha,
inclusive quando uma propriedade está oculta na view.
Campos `text` com máscara também aceitam menções: referências e o gatilho `@`
são preservados literalmente, enquanto entradas comuns continuam mascaradas.

Títulos e células de texto persistem `@{tipo:ULID:campo-codificado-por-URI}`.
O Tiptap usa nós atômicos `mention` com o mesmo id, sem salvar o valor exibido.
O codec compacto mantém o nó como código numérico append-only. Textos antigos
sem esses tokens continuam literais. `npm run mentions:contract:check` verifica
o contrato portátil compartilhado com o frontend.

`POST /mentions/resolve` é uma consulta de leitura com `{ scope, ids }` (até
100 ids). Cada entidade e dependência é autorizada para quem lê. Valores sem
acesso, removidos, cíclicos ou que excedem os limites retornam `null`. A expansão
limita profundidade a oito e tamanho a 20.000 caracteres por valor. Respostas
não persistem o resultado no título nem no documento.

O frontend atualiza consultas após alterações locais de workspace, ao retornar
à aba e a cada 30 segundos enquanto a tela está ativa. A referência continua
estável quando nome, email ou variável muda. A busca/ordenação SQL dos títulos
continua operando sobre o título canônico salvo, que contém os tokens; não há
coluna de projeção materializada para o texto resolvido.

`PATCH /workspaces/:id/variables` recebe `{ key, value: string | null }`.
`null` remove a chave; `""` guarda texto vazio. A escrita parametrizada usa
`json_patch` para alterar uma chave literal por vez, preserva metadados e
verifica `write.update` na mesma operação SQL. A rota exige a mesma capacidade
de edição das configurações da workspace. Limites: chave com 120 caracteres e
valor com 10.000. Não há alteração de schema ou migration.

`PATCH /organizations/:id/variables` usa o mesmo contrato e a mesma tabela de
chave/valor na UI. Exige `organization.write.update` e altera uma chave literal
de `organization.data` por vez, preservando as demais. Os detalhes da organização
ficam em `/organizations/:id`, com abas próprias para workspaces, variáveis,
colaboradores e permissões.
