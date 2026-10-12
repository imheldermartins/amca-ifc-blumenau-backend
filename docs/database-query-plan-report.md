# Paginação: EXPLAIN em fixture isolado

Verificação de 2026-10-12 com SQLite em memória, 10.000 páginas filhas, 50.000 células, cinco propriedades por página, chaves fracionárias reais e toda a cadeia de nove migrations. As células têm somente os campos padrão e o envelope em `data`; não existem projeções tipadas persistidas nem tabela de alvos de relação. A definição da base e os índices são os mesmos do backend. As consultas vêm de `PageViewQueryStore`; cada statement real foi executado também com `EXPLAIN QUERY PLAN`, depois de `ANALYZE`.

O teste reproduzível está em `src/repositories/page-query-plan.test.ts`:

```powershell
npx vitest run src/repositories/page-query-plan.test.ts --maxWorkers=1 --disableConsoleIntercept
```

Os testes usam somente SQLite em memória. Nenhuma conexão com rqlite ou alteração de dados de development é feita por esse teste.

| Consulta | Total SQL | Páginas no payload | Bytes JSON | Máximo de páginas hidratadas pelo SQL |
| --- | ---: | ---: | ---: | ---: |
| Tabela, início | 10.000 | 50 | 46.232 | 50 |
| Tabela, próximo cursor | 10.000 | 50 | 46.556 | 50 |
| Título igual, derivado de `pages.title` | 1 | 1 | 1.199 | 1 |
| Número maior que 9.870 | 130 | 50 | 46.508 | 50 |
| Select igual | 3.334 | 50 | 46.717 | 50 |
| Texto igual com normalização de acento | 39 | 39 | 36.069 | 39 |
| Intervalo de data | 1.071 | 50 | 46.355 | 50 |
| Board, orçamento inicial compartilhado | 10.000 | 50 | 49.138 | 50 |
| Checkbox true raro | 10 | 10 | 9.470 | 10 |
| Checkbox false, incluindo uma célula ausente | 9.990 | 50 | 46.073 | 50 |

A consulta de posições da Tabela lê até 51 IDs/ranks para determinar a existência do próximo cursor. A sentinela não tem título nem células hidratados: uma segunda consulta parametrizada carrega valores completos somente para as 50 páginas visíveis, repetindo autorização, filtros e escopo. A hidratação também revalida o acesso à página. O Board distribuiu as 50 páginas entre grupos com totais 3.334, 3.333 e 3.333. A segunda página da Tabela começa na página 51.

O EXPLAIN confirmou os seguintes caminhos:

- Ordenação e paginação: `idx_page_view_row_order_cursor`, com lookup por aresta/view em `idx_page_view_row_order_edge_view`. A relação com parent/filha vem de `page_edges`, sem duplicá-la na posição.
- Hidratação de células: `idx_page_columns_values_cell`, por `page_id`, depois de limitar as páginas.
- O título é filtrado diretamente de `pages.title`, com a mesma simplificação canônica usada na entrada; não existe coluna ou índice duplicado de título.
- Predicados de células: lookup em `idx_page_columns_values_cell` seguido de `json_extract`/`json_type` sobre `data`. Texto usa simplificação compartilhada; os limites de datas são calculados na leitura.
- Checkbox false ou ausente mantém o LEFT JOIN. Ausência e valor falso compartilham a semântica do filtro, sem criar coluna ou índice auxiliar por tipo.

As migrations que introduziam projeções tipadas foram retiradas por solicitação explícita, com reset autorizado da base LOCAL. A migration `20261012152810732_f6fcf9c3_json_values_edge_view_order_and_page_blocks` cria a ordem por aresta, admite os tipos Relação/Resumo nas colunas e renomeia o armazenamento do editor para `page_blocks`. Esse histórico recomposto não é uma atualização compatível de bancos que já aplicaram as migrations removidas.

As consultas ainda usam B-trees temporárias para agregação e ordenação final: três entradas no conjunto de planos da Tabela e sete no Board. Essas contagens incluem todos os statements de uma projeção, não somente a leitura das páginas. COUNT e autorização continuam avaliando o conjunto elegível completo no banco; limitar o payload não torna a contagem constante.

Na execução isolada de 2026-10-12, a hidratação inicial levou aproximadamente 2,1 ms na Tabela e 8,6 ms no Board; o SQL de contagem levou aproximadamente 76 ms e 160 ms, respectivamente. O fluxo completo, incluindo a coleta de EXPLAIN e as verificações de readiness, levou 100 ms e 186 ms. O filtro de texto normalizado levou 369 ms no fluxo completo, dos quais 170 ms na contagem. Os valores variam entre execuções e não têm assert de tempo. Eles não medem HTTP, transporte rqlite, replicação, concorrência real ou desempenho de produção.

## Avaliação crítica

- Projeções persistidas duplicavam o envelope canônico e exigiam sincronização em todos os writers. Essa complexidade não estava autorizada pelo modelo do produto; foi removida, não apenas ocultada no payload.
- Relação não exige uma tabela de alvos: o array de ULIDs em `data.value` é expandido com `json_each` e os alvos são consultados em `pages`, repetindo a autorização. Há custo de leitura dos arrays e não existe FK por item do JSON. IDs históricos/ocultos são preservados na edição, sem expor título ou valores privados.
- O índice da célula e a PK de `pages` ajudam os joins; isso não torna a busca em qualquer valor JSON automaticamente indexada. COUNT, autorização e normalização ainda percorrem candidatos. O orçamento de 50 limita hidratação/payload, não todo o trabalho SQL.
- `page_blocks` guarda o documento JSON inteiro do editor por página. `revision` é um contador de salvamentos, não uma proteção contra sobrescrita concorrente. Não foi introduzida outra modelagem de blocos nem alterada a API `/document` neste refactor.
- A validação real do editor encontrou três placeholders recebendo quatro binds na ordem errada. O SELECT da escrita procurava uma página usando o JSON do conteúdo como id e não gravava nada. Os binds foram corrigidos; criação, atualização, leitura e bloqueio de escrita em página excluída agora têm regressões específicas. A gravação também foi conferida no rqlite local.
- Snapshots de relação não são copiados automaticamente: permanece `{ "value": ["ULID"] }`. Um histórico opcional poderia ocupar outra chave no mesmo `data`, sem colunas por tipo, mas momento de captura, atualização e regras de acesso precisam ser definidos antes de implementá-lo.
- A cache paginada limita as janelas a 250 páginas. Nascimentos locais/realtime têm uma camada separada de retenção para não desaparecer fora da primeira janela ao perder foco; a resposta autoritativa incorpora esses itens quando os encontra. Essa camada ainda não tem um limite próprio: não se deve anunciar 250 como limite absoluto de toda a memória da view.

## Validação do refactor local

Em 2026-10-12:

- Nove migrations aplicadas oficialmente no rqlite local, `pending: []`; conferência do catálogo real, schema declarado e client gerado passou.
- Suíte completa do backend: 443 testes passaram, sete pulados. Suíte completa do frontend: 698 testes passaram. O teste de 1.000 cards teve um timeout na primeira execução com builds concorrentes; passou isolado e na repetição completa sem alterar seu limite de 30 segundos.
- Builds dos dois projetos, typecheck do backend e conferências cross-repo dos contratos realtime/paginação passaram.
- Nove verificações com dados temporários no rqlite real: schema canônico, ULIDs de relação, Resumo via JSON, simplificação de título, ISO com milissegundos, posição pela aresta, criação/leitura do editor, revisão de salvamento e integridade de FKs. As fixtures foram removidas em `finally`.
- Boot do backend compilado e `/health/ready` conferidos em uma porta local temporária, sem substituir o processo do usuário.
- Lint do frontend terminou sem erros, com cinco avisos: três de exports/Fast Refresh em telas de acesso e dois de dependências de callback da exclusão em lote. Build frontend mantém avisos de chunks grandes. Não foram desativadas regras nem aumentados limites para obter aprovação.

A base LOCAL foi apagada com autorização, sem backup criado nesta execução.
O seed não rodou porque `.env.seed` não existe; as fixtures não deixam contas
ou credenciais. Não foi realizado smoke visual no navegador após o reset, nem
deploy ou atualização de banco remoto. Nenhum arquivo foi staged ou commitado.
