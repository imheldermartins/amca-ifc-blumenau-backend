# Fórmulas no Cub's — versão 1

Uma propriedade `formula` calcula um valor para cada página. Uma linha de tabela é uma página: o cálculo também aparece nas propriedades exibidas por Grid, Board e Calendário. O resultado é somente leitura e não cria uma célula em `page_columns_values`.

## Editor

Adicione **Fórmula**, na seção **Avançado**, ou abra **Editar fórmula** no menu da propriedade. A drawer contém:

1. Editor com destaque roxo.
2. Tipo inferido e referências imediatamente abaixo. Clicar numa referência seleciona sua ocorrência no código.
3. Prévia com valores temporários editáveis. Esses campos não modificam páginas. Relações usam uma página simbólica por destino na prévia; os resultados reais são calculados pelo servidor com as páginas autorizadas.
4. Lista com rolagem vertical de propriedades e funções. Um clique insere diretamente a referência ou `função()` e posiciona o cursor entre os parênteses.

Código válido é salvo automaticamente após uma breve pausa e imediatamente quando o editor perde o foco (`onBlur`). Fechar a drawer aguarda a gravação de uma edição válida. Um rascunho inválido mantém a última fórmula salva funcionando. Falhas de rede ou conflitos de edição são exibidos no editor. Em caso de conflito, reabra a drawer para obter a versão atual; o servidor não aceita sobrescrever uma revisão antiga.

Se a gravação falhar, o editor permanece aberto e oferece **Fechar e manter rascunho**. O rascunho fica apenas na memória dessa página durante a sessão; não substitui a definição persistida nem sobrevive a recarregar o navegador.

## Referências e escopos

Escreva `@Total`, `@{Valor total}` ou escolha a propriedade na lista. Os nomes são uma apresentação: o servidor salva referências como `@columns.<ULID>`, preservando a identidade após renomear uma propriedade. Nomes ambíguos precisam de referência pelo ID.

`@page.title` é o título da página atual. Dentro de `map` e `filter`, a página atual é a página relacionada. `@root.Total` e `@root.page.title` apontam para a página que está executando a fórmula.

```text
if(@Quantidade == 0, markup("Sem estoque", "red"), markup("Disponível", "purple"))
map(@Pedidos, @Valor_Total - @Valor_Solicitado).sum()
map(filter(@Pedidos, !@Cancelado), @Valor_Total).max()
map(@Pedidos, @root.Total - @Valor_Solicitado)
"Total de " + @page.title + ": " + toText(@Total)
```

O primeiro argumento de `map` e `filter` deve ser uma propriedade `relation` ou uma coleção de páginas produzida por `filter`. A segunda expressão usa as propriedades do destino dessa relação. Listas numéricas aceitam `.sum()`, `.avg()`, `.min()` e `.max()`.

Relações limitadas a uma página e propriedades inversas usam o mesmo contrato de coleção. Veja [Relações: configuração e persistência](RELACOES.md).

Para somar somente os valores de uma relação entre limites inclusivos:

```text
map(filter(@Pedidos, @Valor >= 10 && @Valor <= 50), @Valor).sum()
map(filter(@Pedidos, @Valor >= @root.Minimo && @Valor <= @root.Maximo), @Valor).sum()
```

`filter` escolhe as páginas, `map` calcula um número por página e `sum` agrega a lista. Um número isolado não define quais páginas serão percorridas. A ordem dos itens não muda a intenção da soma; valores em ponto flutuante podem apresentar diferenças mínimas de arredondamento.

Uma referência a outra fórmula usa o resultado calculado e seu tipo; a apresentação `markup` é removida nesse uso. Ciclos são rejeitados na validação. Fórmulas encadeadas têm seu próprio `@root` ligado à página dona do cálculo.

## Funções

| Grupo | Funções | Comportamento |
| --- | --- | --- |
| Lógica | `if(condição, então, senão)` | Avalia somente o ramo escolhido. |
| Lógica | `coalesce(valor, alternativa)` | Usa a alternativa para `null`; não oculta erros. |
| Lógica | `isEmpty(valor)` | Verdadeiro para `null`, texto vazio e coleção vazia. Zero e `false` são valores presentes. |
| Conversão | `toNumber(texto)`, `toText(valor)` | Número decimal com ponto; texto de valor simples. `toText(null)` resulta em texto vazio. |
| Número | `abs`, `floor`, `ceil`, `round(número, casas?)` | `round` aceita de 0 a 10 casas; padrão 0. |
| Texto | `lower`, `upper`, `trim`, `length` | `length` conta caracteres Unicode. |
| Texto | `contains`, `startsWith`, `endsWith` | Comparação literal, distinguindo maiúsculas. |
| Texto | `replace(texto, trecho, novo)` | Substitui todas as ocorrências literais. Não aceita regex. |
| Relação | `map(relação, expressão)`, `filter(relação, condição)` | Projeção e seleção de páginas relacionadas. |
| Lista | `sum`, `avg`, `min`, `max`, `count` | Lista vazia: soma/contagem retornam 0; média/mínimo/máximo retornam `null`. `count` aceita também relações. |
| Lista | `unique(lista)`, `join(lista, separador)` | Remove duplicatas simples; une uma lista de textos. |
| Apresentação | `markup(valor, cor?)` | Chip com valor simples. Padrão `grey`. |

As funções também aceitam sintaxe de método: `@page.title.contains("a")` equivale a `contains(@page.title, "a")`.

As cores são `red`, `pink`, `orange`, `yellow`, `green`, `blue`, `purple` e `grey`, usando os chips do sistema. Conteúdo textual é escapado: `markup` não interpreta HTML.

## Tipos e operadores

Tipos de saída: número, texto, booleano, vazio (`null`), lista e chip. `if` pode inferir uma união de tipos, e operações posteriores precisam aceitar todos esses tipos.

Operadores: `+ - * / %`, `== != < <= > >=`, `! && ||`. Use parênteses para controlar a precedência. `&&`, `||`, `if` e `coalesce` fazem avaliação condicional.

`+` soma dois números ou concatena quando um operando é texto. Os outros operadores aritméticos exigem números. A comparação de igualdade é estrita. Não há conversão implícita de texto monetário, vírgula decimal ou booleanos em números. Números usam ponto flutuante IEEE 754.

Propriedades sem valor produzem `null`. Para somar um número opcional, use `coalesce(@Total, 0)`. Uma lista com números ausentes também precisa de tratamento explícito dentro do `map`.

Erros sintáticos, tipos incompatíveis, referências inválidas, ciclos e erros constantes como `1 / 0` impedem salvar. Um erro dependente dos dados de uma página aparece nessa célula; ele não apaga a fórmula das outras páginas. Excluir uma propriedade ou mudar seu tipo pode tornar fórmulas dependentes indisponíveis até corrigir a referência.

Nesta versão, `date` e `flow` não podem ser usados como operandos. Fórmulas não participam de filtros, agrupamentos ou eixos de visualização. `filter()` continua disponível para relações dentro da expressão.

## Execução e API

O motor é um interpretador fechado, com lexer, parser de precedência e registro de operações com assinatura, estratégia e execução. Não usa `eval`, `Function`, código JS fornecido pelo usuário, propriedades arbitrárias, funções externas, loops, I/O ou acesso a objetos globais.

A fonte canônica está em `src/services/formulas/engine`. O frontend consome uma cópia conferida pelo script `formula:engine:check`; alterações são transferidas com `formula:engine:sync`. A mesma semântica é usada na prévia, e o servidor sempre recompila o código recebido. AST, dependências e tipo enviados por um cliente não são aceitos como autoridade.

| Endpoint | Finalidade |
| --- | --- |
| `GET /api/v1/pages/parent/:id/formula/catalog` | Catálogo autorizado de propriedades e destinos de relações. |
| `POST /api/v1/pages/parent/:id/formula/preview` | Valida `{ source, columnId?, pageId? }`. Com `pageId`, calcula sobre dados reais autorizados. |
| CRUD existente de colunas | Recebe `formula: { version: 1, source, expectedRevision? }`. Em atualização, exige a revisão da definição atual. |
| `GET /api/v1/pages/:id/column/:column_id/value` | Lê o resultado para a página e o usuário autenticado. |

Persistência em `page_columns.data.formula`: `version`, `source` canônica, `revision`, `resultType` e `dependencies`. O resultado não é persistido. A atualização usa comparação atômica do estado anterior para rejeitar concorrência e preservar a definição vencedora.

O repositório busca em lotes os valores mencionados, incluindo dependências de outras fórmulas. Só páginas autorizadas contribuem. Resultados não são compartilhados num cache entre usuários nem enviados no socket. Mudanças publicam invalidação de projeção da base e das bases que dependem dela transitivamente por relações; a paginação existente atualiza os resultados em segundo plano sem esvaziar a tela.

Limites atuais: 8.192 bytes por expressão, 1.024 nós, profundidade 64, até 250 páginas por relação e 100.000 unidades de trabalho por avaliação. Cadeias de fórmulas compartilham um limite de 8.192 nós e 65.536 bytes na compilação. Texto de resultado tem até 65.536 unidades UTF-16. O catálogo limita-se a 512 propriedades em 32 bases; a materialização por cálculo é limitada a 2.500 páginas e 16 níveis. Exceder limites gera erro explícito.

## Migração de `rollup`

O discriminador `page_columns.type` foi renomeado para `extract_as`. O comportamento e a configuração `data.rollup`/`rollupResult` são preservados, evitando alterar cálculos existentes. A migration append-only reconstrói a restrição de tipos, converte os registros e preserva os vínculos de valores, pins e solicitações da agenda dentro da mesma transação. A interface continua usando o nome **Resumo**.
