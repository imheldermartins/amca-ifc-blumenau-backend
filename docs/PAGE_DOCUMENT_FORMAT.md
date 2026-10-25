# Formato compacto dos documentos

Frontend e backend usam o mesmo codec portátil em `page-document-codec.ts`.
`npm run document:codec:sync` copia a fonte canônica do backend para o frontend;
`npm run document:codec:check` verifica a igualdade.

O Tiptap continua recebendo seu JSON nativo em memória. Antes de enviar e gravar,
o codec substitui as chaves estruturais por tuplas e referências de tipo:

```json
{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Olá"}]}]}
```

torna-se:

```json
{"v":1,"b":[[0,["Olá"]]]}
```

`v` versiona o codec e `b` contém os nós do documento (o tipo raiz `doc` é
implícito). Texto simples é uma string. Os demais nós usam
`[tipo, corpo?, atributos?, marcas?]`; marcas usam `[tipo, atributos?]`.
Os códigos numéricos de nós e marcas são tabelas append-only da versão 1.
Tipos de extensões ainda sem código conservam o nome como referência de tipo.
Não há gzip/base64 da árvore, alteração de tabelas ou migration.

Atributos e corpos continuam preservados: IDs, colunas/proporções, listas,
checkboxes, imagens, referência de formulário, LaTeX inline/em bloco e linguagem
de code-block. A forma de transporte e armazenamento é JSON sem indentação;
`page_blocks.content` continua sendo JSON válido.

O frontend lê documentos antigos e compactos. A API aceita os dois formatos de
escrita e sempre grava o compacto; conteúdos existentes não são regravados por
uma simples leitura. O carregamento de dados antigos permanece compatível;
frontend e backend atualizados devem ser publicados juntos para os clientes
entenderem as novas respostas. `revision` mantém sua semântica de contador de
salvamento e não é um mecanismo de controle de concorrência.

Entrada e expansão têm limite de 240.000 caracteres, profundidade 64 e até
10.000 nós/marcas. Payloads inválidos ou de versões desconhecidas são rejeitados
antes da escrita. O placeholder é uma decoração visual: aparece desde o
carregamento quando o documento está vazio e, nos demais casos, apenas na linha
vazia com foco. Não faz parte dos dados persistidos. A serialização e a escrita
aguardam 600 ms sem digitação; alterações pendentes são descarregadas ao sair.
