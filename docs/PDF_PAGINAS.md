# PDF de páginas e templates Recursive

No menu de usuários no canto superior da página, **Gerar PDF** (ícone de download) permite visualizar e baixar o título e o conteúdo salvo da página. A exportação não contém o cabeçalho de navegação, favoritos, colaboradores ou botões de formulário.

O switch **Incluir título da página** vem ligado e controla somente o título automático no início do PDF, tanto na prévia quanto no download individual ou em lote. Desligar não remove títulos escritos no conteúdo nem as menções ao título e não altera o nome do arquivo. No Flow, a mesma opção aparece abaixo de **Anexar PDF da página** e fica salva na ação. Exportações e ações antigas continuam incluindo o título por padrão. A API aceita `includePageTitle: false` no corpo de `POST /pages/:id/pdf`.

**Table Recursive** e **Calendar Recursive** exigem uma propriedade **Relation**. Cada bloco usa os itens vinculados nessa propriedade da página exportada, seja um item ou vários, na ordem da relação. As menções de item usam IDs que incluem a Relation e a coluna da base de destino; nunca usam as outras filhas da base de origem. Páginas removidas, sem acesso ou fora do destino ficam de fora.

A **Table Recursive** é uma tabela HTML editável dentro do documento, com seletor de Relation, células com texto/menções, linhas fixas e linhas repetidas. É possível adicionar/excluir linhas e colunas, marcar cabeçalhos e mesclar/separar células por `colspan` e `rowspan`. Mesclas verticais não cruzam a fronteira entre uma linha fixa e uma repetida. Linhas roxas repetem uma vez por item da Relation; linhas fixas usam as propriedades da página daquele PDF. Assim, `Total: @Valor_Total` pode ocupar uma célula mesclada após os itens e aparecer uma única vez. Relações vazias mantêm cabeçalhos e totais fixos. Configurações antigas por lista de campos são convertidas na leitura; menções antigas que apontavam para colunas da origem devem ser revisadas para escolher as propriedades do destino.

A modal abre diretamente com a prévia real em uma área rolável. O nome do arquivo fica à esquerda; o switch de título e o único botão de download ficam à direita. Alterar o switch refaz a prévia automaticamente. O PDF individual baixado reutiliza os mesmos bytes da prévia.

O título da página também aceita menções às suas `page_columns`, incluindo Formula, Relation e Resumo. As referências são resolvidas com o motor e as regras de acesso existentes, inclusive no título e nome do PDF; referências cíclicas continuam indisponíveis.

No calendário, uma propriedade de data define a posição do card. Apenas meses ocupados são renderizados, em grids mensais, com todos os cards visíveis. Filhas sem data válida ficam de fora. Intervalos seguem datas civis UTC do codec existente.

Ao selecionar uma linha da tabela, **Gerar PDF da página selecionada** aparece ao lado dos filtros e abre a prévia do arquivo único. Com duas ou mais linhas, a mesma posição mostra **Gerar PDF em Lote**. O editor de blocos do pai é sempre o template da seleção: título e variáveis escalares assumem a filha selecionada, e cada bloco Recursive lista os itens da Relation daquela filha. O lote gera diretamente um ZIP com um PDF por filha e mostra somente a confirmação centralizada com o nome do arquivo; não gera uma prévia da primeira selecionada. O download reutiliza o PDF/ZIP já gerado. A ação **Gerar PDF** na modal de usuários sempre exporta os blocos da própria página aberta, independentemente da seleção e sem usar o pai como template.

No Flow, o switch **Anexar PDF da página** sempre usa o editor de blocos do pai como template, sem seletor de molde. O switch de título controla o cabeçalho automático. A outbox guarda somente IDs e o usuário responsável; o worker verifica novamente o acesso e gera o anexo no momento da entrega. Uma nova tentativa usa o estado atual da página. O PDF não é persistido na outbox.

## API e recursos

- `GET /pages/:id/pdf/catalog`: filhas diretas acessíveis e metadados de colunas/Relations com propriedades dos destinos autorizados, sem valores de células.
- `POST /pages/:id/pdf` com `{}`: PDF da própria página.
- `POST /pages/:id/pdf` com `{ "childIds": ["ULID"] }`: template do pai aplicado às filhas; resposta PDF ou ZIP.
- Autenticação e leitura são obrigatórias para a origem, cada filha e referências externas. A resposta binária usa `Cache-Control: no-store` e `Content-Disposition`.
- Limites: 50 PDFs por lote, 2000 filhas por origem, 20 MB por PDF e 64 MB por lote. O calendário rejeita intervalos acima de 10 anos ou mais de 3660 dias distintos. Limites geram erro; não há exportação parcial silenciosa.

O serviço gera HTML escapado e imprime com Chromium sem executar JavaScript nem acessar URLs/arquivos de conteúdo externo. Imagens inline e fontes são incorporadas. Os bytes de PDF/ZIP existem somente em memória, sem caminho de arquivo ou registro no banco. Os buffers de saída são zerados ao encerrar a resposta/envio; URLs de download são revogadas. A prévia desenha as páginas em canvas com PDF.js e libera documento, tarefas de renderização e worker ao fechar. O perfil temporário interno do Chromium é gerenciado e removido pelo Puppeteer ao fechar o navegador.

## Ambiente e verificação

Após instalar dependências em desenvolvimento, `npm run pdf:setup` instala o Chromium compatível. Opcionalmente configure `PUPPETEER_EXECUTABLE_PATH`. A imagem de produção instala Chromium e fontes e configura o executável; não é necessária migration.

`npm run recursive:contract:check` compara o contrato de projeção entre os repositórios. `npm run pdf:preview:check` gera um PDF em memória, verifica seu texto e grava somente PNGs de revisão em uma pasta temporária indicada na saída. O comando usa `.env.development` para inicializar os módulos, com repositório fictício e sem consultar ou alterar dados.

## Exemplo real para Helder

Os comandos `pdf:example:prepare`, `pdf:example:review`, `pdf:example:browser` e `pdf:example:send` usam a conta verificada `eusouhelder123@gmail.com` no banco de desenvolvimento e exigem a API local em `:3000` (e o frontend em `:5173` para o navegador). A preparação cria a página **Testes · PDF, Recursive e Relation** na workspace pessoal, com quatro entregas, três projetos relacionados e um Flow com anexo do template do pai.

Os IDs e resultados ficam em `artifacts/pdf-example-helder/manifest.json`, sem tokens ou PDFs. A revisão verifica títulos de Relation no PDF, ZIP com dois documentos e rejeição atômica de um vínculo fora da database. As imagens PNG permitem revisar o resultado sem persistir o PDF. O teste de navegador usa uma sessão isolada da conta para autenticação; dados, gravações e geração de PDF usam a API real.

`npm run pdf:example:send` envia email real exclusivamente ao endereço acima, pelo Flow e pelo worker restrito à entrega criada. O estado `sent` e o ID de mensagem SMTP são registrados no manifesto; repetir esse comando depois do sucesso não envia outra mensagem.
