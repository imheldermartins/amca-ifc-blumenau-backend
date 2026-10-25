# Regra do mapa de calor

O mapa considera uma propriedade `date` e uma lista não vazia de propriedades
`checkbox` da mesma base. Todas as checkboxes usam a mesma data de agrupamento.
Filtros da view e permissões de leitura se aplicam tanto às contagens quanto à
lista de páginas aberta ao selecionar um dia. Intervalos de data são ignorados.

## Contagem e cor

`C(d)` soma as checkboxes selecionadas que estão marcadas nas páginas do dia `d`.
Uma página pode contribuir mais de uma marcação, mas aparece uma única vez na
lista. Checkboxes ausentes ou desmarcadas contribuem zero. O total de páginas é
informado separadamente; ele não é o denominador da intensidade.

A semana vai de domingo a sábado. Seja `M` o maior `C(d)` da semana:

```text
intensidade = M > 0 ? clamp((C(d) / M - 0.10) / 0.90, 0, 1) : 0
```

Até 10% do máximo semanal não há roxo. O máximo tem roxo pleno. Se `M = 13`,
contagens 1, 2, 7 e 13 recebem respectivamente 0%, 6%, 49% e 100% de intensidade
(percentuais arredondados apenas para exibição). A regra vale nos modos mensal e
ano contínuo, inclusive nas semanas que atravessam meses. Nas bordas do período,
apenas os dias incluídos no período contribuem para o máximo.

## Configuração e projeção

A configuração da view usa `heatmap: { version: 2, dateColumnId,
checkboxColumnIds, period }`. `period` mantém os modos `months` (1–12 meses) e
`year`. A API valida IDs únicos e colunas do tipo correto na própria base.
Configurações legadas `version: 1` com `checkboxColumnId` são lidas como uma
seleção de um elemento. Alterações da regra gravam a versão 2, sem migration.

A projeção retorna `checkboxColumnIds` e `heatmapDays[YYYY-MM-DD]` com
`{ total, checked }`: número de páginas e soma de marcações, respectivamente.
Selecionar um dia solicita um stream paginado com escopo
`{ type: 'heatmap', from, to, day }`, sem substituir a projeção visual do período.
A descrição da regra na interface é derivada da configuração selecionada.
