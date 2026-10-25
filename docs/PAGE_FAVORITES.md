# Favoritos pessoais de páginas

O usuário pode favoritar uma página pela estrela no cabeçalho e acessá-la pela seção **Favoritos** do seletor de espaços de trabalho. A seção é recolhível, tem rolagem e carrega mais resultados sob demanda. Somente a preferência de recolhimento fica no armazenamento local, separada por usuário.

## API autenticada

As rotas usam o prefixo `/api/v1` e sempre obtêm o usuário da sessão:

| Método e rota | Resultado |
| --- | --- |
| `GET /favorites/pages?limit=50&cursor=...` | `{ items, nextCursor, total }` dos favoritos legíveis pelo usuário |
| `GET /favorites/pages/:pageId` | `{ pageId, favorite }` ou 404 quando a página não é legível |
| `PUT /favorites/pages/:pageId` | Adiciona o favorito de forma idempotente; exige leitura da página |
| `DELETE /favorites/pages/:pageId` | Remove somente o favorito do usuário, inclusive após perder acesso à página |

O limite aceito é de 1 a 50. O cursor é opaco e mantém a ordem por data de inclusão e ID, ambos decrescentes. A filtragem por acesso e exclusão lógica acontece antes da paginação e da contagem. Cada item contém `pageId`, `title`, `createdAt`, `workspaceId` e `workspaceName`; os dados da workspace ficam nulos quando o usuário não pode lê-la.

## Persistência

`page_favorites` guarda `id`, `user_id`, `page_id`, `created_at` e `updated_at`, com unicidade por usuário/página e chaves estrangeiras com exclusão em cascata. Favoritar não altera o conteúdo, a data de edição nem as permissões da página. Os favoritos são independentes das fontes de calendário fixadas em `pinned_schedule_pages`.

A migration aditiva é `20261025024712094_68ff1f26_add_page_favorites`. O frontend separa o cache por usuário e atualiza a estrela imediatamente durante a gravação. Em falhas, restaura o estado anterior e usa o feedback global. A resposta confirmada atualiza o cache compartilhado; leituras em andamento são canceladas para não sobrescrever essa confirmação. A lista aberta é atualizada a cada 30 segundos e ao retornar à janela.

## Verificação

`src/repositories/page-favorite-repository.test.ts` cobre isolamento por usuário, acesso revogado, exclusões, paginação estável, idempotência e validação da API. No frontend, `src/components/PageFavorites.test.tsx` cobre a estrela, erros, recolhimento, paginação, navegação, remoção e troca de usuário.
