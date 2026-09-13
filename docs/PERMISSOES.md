# Organizações, roles e solicitações

O criador é identificado por `organizations.owner_id`, recebido da sessão, e
possui todos os poderes da organização e das workspaces e páginas nela contidas.
Ownership não depende de um template e não pode ser retirado pela gestão de
membros. `workspaces.created_by_user_id` e `pages.owner_id` preservam a autoria e
o acesso dos criadores. Não há autorização baseada em nomes de papéis.

Os demais acessos vêm de `organization_roles`, `workspace_roles` e `page_roles`.
Cada template tem `id`, identificador do escopo, `name`, `roles` JSON, `is_default`,
`system_key`, `deleted_at` e timestamps. Cada recurso nasce com uma role `Default`
de acesso completo ao próprio escopo. Ela pode ser editada, mas não excluída.
As memberships guardam, respectivamente, `organization_member_role_id`,
`workspace_member_role_id` e `page_member_role_id`. A última vive em
`page_collaborators`, o vínculo único existente das páginas. O JSON é
`{ "read": ["view"], "write": [] }`. Uma role vazia nega acesso.

## Catálogo e hierarquia

`GET /api/access/catalog` é a fonte do catálogo utilizado pela interface.

| Escopo | Leitura | Escrita |
| --- | --- | --- |
| organization | view, workspaces, members, roles | update, create, add_members, promote_members, create_org_roles, manage_workspaces |
| workspace | view, members, roles | update, create, add_members, promote_members, create_wk_roles, manage_pages |
| page | view, subpages, members, roles | update, create, edit_subpages, delete, add_members, promote_members, create_page_roles |

Toda permissão depende de `read.view`. Na organização, `read.workspaces` expõe o
catálogo; a resposta informa `canEnter` separadamente. Ver a workspace no catálogo
não cria membership nem concede entrada. `write.create` cria ou vincula
workspaces; vincular uma existente também exige ser seu proprietário, pois o
owner da organização passa a administrá-la. Dentro da organização, criar uma
workspace não exige outra chave.

`organization.write.manage_workspaces` concede a gestão de todas as workspaces
e páginas da organização. `workspace.write.manage_pages` concede a gestão das
suas páginas. O criador e o owner herdado mantêm sua soberania.

Para colaboradores de páginas, a role explícita mais próxima controla o ramo.
`read.subpages` permite herdar leitura. Editar páginas descendentes depende de
`write.edit_subpages`, que exige `read.subpages` e `write.update`. Gerenciar roles,
admitir pessoas e excluir páginas não são permissões herdadas de uma role de
página; precisam de concessão no escopo ou da gestão da área superior.

## Delegação e edição

Gerir templates exige a permissão `create_*_roles` correspondente. Vincular outra
role exige `promote_members`; admitir alguém exige `add_members`. Só é possível
conceder permissões contidas no próprio acesso. Também não é possível editar uma
role, reduzir ou remover um membro com poderes superiores aos do ator. O owner
é protegido independentemente da role. Todas essas condições são reavaliadas no
SQL da escrita, dentro da transação.

Editar um template altera os acessos de todos os membros vinculados. O frontend
avisa isso antes do botão Salvar. Para uma exceção individual, crie outro
template e vincule-o à pessoa. Updates usam `expectedUpdatedAt` para detectar
edições concorrentes e evitar perda silenciosa de alterações.

## HTTP e telas

Prefixo comum: `/api/access/:scope/:id`, com escopo `organization`, `workspace`
ou `page`; todos os endpoints exigem autenticação.

| Método e sufixo | Corpo / resultado |
| --- | --- |
| GET (sem sufixo) | ownership, membership, role e permissões efetivas |
| GET /roles | templates do escopo |
| POST /roles | `{ name, roles }` |
| PUT /roles/:roleId | `{ name, roles, expectedUpdatedAt }` |
| DELETE /roles/:roleId | soft-delete; recusa Default, roles de sistema e roles com membros ativos |
| GET /organization-workspace-roles | na workspace, lista roles das outras workspaces da mesma organização como referência |
| POST /roles/:roleId/copy | copia uma role externa para a workspace atual como template independente |
| GET /members | identidades, vínculos e templates; inclui o proprietário |
| GET /member/:id | aceita id do usuário ou vínculo; inclui permissões efetivas |
| GET /member-search?email= | busca somente o e-mail completo e informa se já é membro |
| POST /members | compatibilidade: cria convite individual `{ email, roleId? }` |
| PUT /member/:userId | `{ roleId }` |
| DELETE /member/:userId | remove vínculo, preservando proprietário |
| GET /requests | pedidos próprios ou todos, se puder admitir membros |
| POST /requests | pedido idempotente enquanto estiver pendente |
| POST /requests/:requestId/decision | `{ decision: "accepted", roleId }` ou `{ decision: "rejected" }` |
| GET/POST /invites | histórico e criação de convite individual ou link genérico |
| DELETE /invites/:inviteId | grava `deleted_at` e força `status=expired` |

As organizações têm telas próprias em `/:lang/organizations`, `/new` e `/:id`,
sem ícones. Somente workspaces têm ícones. A identificação da workspace no app
mostra `Organização • Workspace`. A antiga aba de organização redireciona à nova
rota, preservando favoritos.

Os membros, templates e pedidos usam `/:lang/access/:scope/:id`, `/roles`,
`/member/:id` e `/requests/:requestId`. A tela de membro apresenta labels e
switches alinhados, com `SwitchAccordion` do pacote `cubs-components` para
dependências. Desligar o pai remove as permissões dependentes do payload.

## Solicitações e e-mail

`access_invites` registra escopo, role, autor, destinatário opcional, expiração,
limite e contagem de aceites. O link genérico não é vinculado a um e-mail, mas
só uma conta com `email_verified_at` pode aceitá-lo. O padrão é 24 horas e
aceites ilimitados; a API também aceita 7 dias, sem prazo, um aceite ou um limite
customizado. Cada aceite fica em `access_invite_acceptances` com o `user_id` real.

Convite de workspace cria, quando necessário, uma membership de organização com
a role de sistema `workspace_guest`, que contém somente `organization.read.view`.
Convite de página cria essa mesma base, a membership com a `Default` da workspace
e, por fim, a role escolhida da página. Assim o convite não libera o catálogo de
todas as workspaces. Convites individuais são sempre aceitos pelo destinatário;
não existe adição silenciosa de uma conta já validada.

As tabelas `organization_pending_requests`, `workspace_pending_requests` e
`page_pending_requests` separam os escopos. Guardam solicitante, status,
`notified_emails`, role escolhida, `accepted_by`, `decided_by`, `decided_at` e
timestamps. `notified_emails` contém os destinatários aceitos pelo SMTP, não uma
lista presumida de envios. Os destinatários são membros/proprietários com
`add_members`, incluindo gestores da área superior quando aplicável.

Abrir o link apenas mostra a revisão autenticada. O aceite revalida a permissão
do ator e a role no mesmo commit que cria a membership. `accepted_by` vem da
sessão, nunca do corpo. Aceites concorrentes só podem criar um vínculo. Para
workspace, o novo membro recebe sua própria página de entrada; GET nunca cria
páginas. Se SMTP falhar, o pedido continua visível na tela, com
`notificationPending: true` na criação. Uma nova chamada sobre o pedido pendente
não reenvia e-mails automaticamente.

## Cadastro, convites e migração

O cadastro comum começa apenas com nome e e-mail. `account_verifications` guarda
o hash de um token de 24 horas; reenvio após 60 segundos invalida o token anterior.
O clique abre `/:lang/verify-email/:token`, no layout do SignIn, para definir a
senha. Só essa conclusão grava `email_verified_at`, cria a workspace privada e
inicia a sessão. Um convite para endereço ainda não cadastrado usa o mesmo clique
para validar o e-mail e aceitar o acesso.

Criar uma organização não usa chave. A rota exige a sessão emitida após a
validação do e-mail e grava o usuário autenticado como owner. A Home preserva
esse destino durante cadastro e confirmação.

A confirmação do cadastro cria a base pessoal do usuário. Depois disso, toda
nova workspace criada pela sessão precisa informar uma organização na qual o
usuário tenha `write.create`; esse fluxo não usa chave.

As migrations `20260912041438_scoped_roles_access_keys_and_membership_requests`,
`20260912114500_verified_accounts_invites_and_soft_delete` e
`20260912130000_remove_organization_access_keys` são transacionais e preservam
raízes, vínculos e auditoria. Cada acesso legado vira
um template editável. Como organizações antigas não guardavam o criador, o owner
é a primeira membership por `created_at`, com desempate por id. A coluna de role
fixa e as duas tabelas antigas de chave são removidas. Migrations anteriores
permanecem intactas por já terem sido aplicadas. A migration append-only
`20260913170000_drop_access_keys` remove as tabelas legadas restantes; o código
da aplicação não possui mais rotas ou serviços de chave. Backend e frontend
devem ser atualizados juntos.

## Validação

`npm test` cobre contratos, SMTP com transporte injetado, templates, migração com
dados legados e autorização. Para integração com uma base descartável, publique
rqlite em `127.0.0.1:18012`, aplique migrations e execute
`RUN_RQLITE_INTEGRATION=1 RQLITE_PORT=18012 npm test -- src/core/db/scoped-access.integration.test.ts`
(em PowerShell, defina as duas variáveis com `$env:` antes do comando).
O script recusa outra porta. Não execute seed sobre a base de desenvolvimento
para testar a migração.
