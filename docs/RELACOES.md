# Relações: cardinalidade, sentido inverso e snapshots

## Configuração

No menu da propriedade, **Configurar relação** permite escolher a base de destino e o limite: **Uma página** ou **Várias páginas**. O limite pertence à propriedade, em todas as visualizações. Relações antigas continuam aceitando várias páginas.

O catálogo de destinos inclui somente páginas legíveis com pelo menos uma página filha ativa. Esse critério também é validado ao salvar a configuração. A busca e o limite são aplicados depois dessa restrição; uma página sem propriedades continua elegível quando tem filhas. A hierarquia existente em `page_edges` define o critério, sem um campo adicional de classificação de database.

**Mostrar no destino** cria uma propriedade Relation no destino, com o nome informado. Essa criação acontece somente ao ativar a opção. Cada lado tem seu próprio limite:

| Origem | Destino | Cardinalidade |
| --- | --- | --- |
| Uma página | Uma página | 1:1 |
| Várias páginas | Uma página | 1:N |
| Uma página | Várias páginas | N:1 |
| Várias páginas | Várias páginas | N:N |

Editar qualquer lado atualiza os dois. Relações entre páginas da mesma base também funcionam, com duas propriedades distintas. Na célula limitada a uma página, selecionar outra página substitui a seleção atual. Se o lado inverso já estiver ocupado, a API recusa a operação inteira: remova o vínculo anterior primeiro.

Ao mudar uma propriedade existente para **Uma página**, nenhuma seleção é descartada. Se alguma célula ainda contiver múltiplos vínculos, o editor mantém a configuração aberta e mostra o erro retornado pelo servidor.

Desativar **Mostrar no destino** preserva as duas propriedades e os valores atuais. Elas passam a funcionar de maneira independente. Antes de excluir uma propriedade pareada ou trocar seu tipo, desative a bidirecionalidade. O nome de uma propriedade inversa existente pode ser alterado pelo próprio cabeçalho no destino.

## Persistência

- `page_columns.data.relation` guarda `version`, `targetDatabaseId`, `cardinality` (`one` ou `many`) e o `inverseColumnId` atribuído pelo servidor.
- `page_columns_values` continua identificando cada célula por página e coluna. `VALUE_CODECS.relation` conserva o envelope `{"value":["ULID", "..."]}`, inclusive para cardinalidade um.
- `page_relation_links` contém `source_cell_id`, `target_page_id` e `position`. A chave composta impede repetição do mesmo destino na mesma célula; um índice pelo destino atende consultas inversas e invalidações.

O array persistido é o snapshot editável da célula. Triggers derivam o índice SQL na mesma transação, inclusive durante alterações de tipo. Uma relação bidirecional tem um snapshot por propriedade; o repository atualiza ambos atomicamente. Não há fila, sincronização posterior nem duas requisições HTTP para confirmar uma edição.

O identificador de um conjunto auxiliar não substitui `data.value`: manter o envelope existente evita uma segunda fronteira de serialização nas leituras de fórmulas, páginas e visualizações. Os IDs das páginas continuam sendo as referências. `page_edges` permanece exclusivamente responsável pela hierarquia.

Os snapshots de visualização em `pages.data[viewId]` não recebem vínculos.

## Consistência e acesso

Cada transação compara as definições e os snapshots lidos antes de escrever. Uma alteração concorrente cancela a operação inteira, com HTTP 409. A API também verifica limites, vínculo entre página e base, permissões de escrita e bloqueios das propriedades em ambos os lados. Ativar a relação inversa sobre dados existentes exige poder editar os destinos que receberão os snapshots.

Vínculos ocultos ao usuário são preservados durante edições. Leitura, resumos e fórmulas respeitam as permissões; o socket publica invalidações de projeção sem transmitir valores privados. Soft delete não apaga os snapshots históricos, e destinos inativos deixam de participar dos resultados autorizados.

A restrição de uma página também é validada no SQL, tanto ao editar valores quanto ao mudar a configuração. “Várias páginas” mantém o limite operacional atual de 250 referências por célula.

## Fórmulas

Uma Relation continua sendo uma coleção de páginas, mesmo limitada a uma:

```text
map(@Pedidos, @Valor_Total - @Valor_Solicitado).sum()
map(@Pedidos, @Valor_Total).max()
map(filter(@Pedidos, @Valor_Total >= 10 && @Valor_Total <= 50), @Valor_Total).sum()
```

`map` transforma cada página; `filter` restringe quais páginas participam; `.sum()` soma os resultados. O intervalo pertence ao filtro. A propriedade inversa pode ser usada da mesma forma. Referências são persistidas pelo ID canônico da propriedade, independentemente de seu nome.

Ver também [manual de fórmulas](FORMULAS.md).
