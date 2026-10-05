# Paginação: EXPLAIN em fixture isolado

Verificação de 2026-10-05 com SQLite em memória, 10.000 páginas filhas, 50.000 células, cinco propriedades por página, chaves fracionárias reais e toda a cadeia de migrations. A definição da base e os índices são os mesmos do backend. As consultas vêm de `PageViewQueryStore`; cada statement real foi executado também com `EXPLAIN QUERY PLAN`, depois de `ANALYZE`.

O teste reproduzível está em `src/repositories/page-query-plan.test.ts`:

```powershell
npx vitest run src/repositories/page-query-plan.test.ts --maxWorkers=1 --disableConsoleIntercept
```

Os quatro testes passaram. Nenhuma conexão com rqlite ou alteração de dados development é feita por esse teste.

| Consulta | Total SQL | Páginas no payload | Bytes JSON | Máximo de páginas hidratadas pelo SQL |
| --- | ---: | ---: | ---: | ---: |
| Tabela, início | 10.000 | 50 | 46.279 | 50 |
| Tabela, próximo cursor | 10.000 | 50 | 46.629 | 50 |
| Título igual | 1 | 1 | 1.219 | 1 |
| Número maior que 9.870 | 130 | 50 | 46.555 | 50 |
| Select igual | 3.334 | 50 | 46.763 | 50 |
| Texto igual com normalização de acento | 39 | 39 | 36.089 | 39 |
| Intervalo de data | 1.071 | 50 | 46.401 | 50 |
| Board, orçamento inicial compartilhado | 10.000 | 50 | 49.314 | 50 |
| Checkbox true raro | 10 | 10 | 9.490 | 10 |
| Checkbox false, incluindo uma célula ausente | 9.990 | 50 | 46.120 | 50 |

A consulta de posições da Tabela lê até 51 IDs/ranks para determinar a existência do próximo cursor. A sentinela não tem título nem células hidratados: uma segunda consulta parametrizada carrega valores completos somente para as 50 páginas visíveis, repetindo autorização, filtros e escopo. A conferência final de revisão também revalida o acesso à página. O Board distribuiu as 50 páginas entre grupos com totais 3.334, 3.333 e 3.333. A segunda página da Tabela começa na página 51.

O EXPLAIN confirmou os seguintes caminhos:

- Ordenação e paginação: `idx_page_view_row_order_cursor`, com lookup por linha em `idx_page_view_row_order_row`.
- Hidratação de células: `idx_page_columns_values_cell`, por `page_id`, depois de limitar as páginas.
- Igualdade de título normalizado: `idx_pages_title_search`.
- Predicados de células: `idx_page_values_number`, `idx_page_values_select`, `idx_page_values_search` e `idx_page_values_date_end` no intervalo examinado.
- Checkbox true: `idx_page_values_checkbox`. Checkbox false ou ausente mantém o LEFT JOIN e usa o índice único de célula; o índice parcial de checkbox não pode representar células inexistentes.

O índice de checkbox foi acrescentado pela migration append-only `20261005042200087_ab97d31a_index_paginated_checkbox_predicates`, sem editar a migration de paginação já aplicada.

As consultas ainda usam B-trees temporárias para agregação e ordenação final: três entradas no conjunto de planos da Tabela e sete no Board. Essas contagens incluem todos os statements de uma projeção, não somente a leitura das páginas. COUNT e autorização continuam avaliando o conjunto elegível completo no banco; limitar o payload não torna a contagem constante.

Na última execução isolada, a hidratação inicial levou aproximadamente 2,1 ms na Tabela e 7,5 ms no Board; o SQL de contagem levou aproximadamente 71 ms e 165 ms, respectivamente. O fluxo completo, incluindo a coleta de EXPLAIN e as verificações de readiness, levou 113 ms e 213 ms. Os valores variaram entre execuções e não têm assert de tempo. Eles não medem HTTP, transporte rqlite, replicação, concorrência real ou desempenho de produção.
