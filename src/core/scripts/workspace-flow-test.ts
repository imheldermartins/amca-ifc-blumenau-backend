import roleStore from "@db/role-store";
import { fullPermissions } from "@core/auth/permissions";
import { ulid } from "ulid";
import db from "@models/index";
import authController from "@controllers/auth-controller";
import workspacesController from "@controllers/workspaces-controller";
import organizationsController from "@controllers/organizations-controller";
import workspaceStore from "@db/workspace-store";
import accessInviteStore from "@db/access-invite-store";
import type { Schema } from "@/models/schemas/index";
import { createOpaqueToken, hashOpaqueToken, opaqueTokenHint } from "@/services/opaque-token";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const port = process.env.RQLITE_PORT;
  if (!port || port === "8000") {
    throw new Error(
      "Este teste cria dados. Execute somente contra um rqlite isolado usando RQLITE_PORT diferente de 8000.",
    );
  }

  const runId = ulid().toLowerCase();

  const privateRegistration = await authController.register({
    name: "Helder Teste",
    email: `private-${runId}@workspace.test`,
  });
  assert(privateRegistration.ok && privateRegistration.verificationRequired,
    "O cadastro comum não iniciou a validação por e-mail.");

  const creator = await db.users.create({
    name: "Criadora Teste",
    email: `creator-${runId}@workspace.test`,
    email_verified_at: new Date().toISOString(),
  } as CreateValues<Schema.User>);
  const member = await db.users.create({
    name: "Membro Teste",
    email: `member-${runId}@workspace.test`,
    email_verified_at: new Date().toISOString(),
  } as CreateValues<Schema.User>);
  assert(creator && member, "Não foi possível criar os usuários de teste.");

  const organizationCreation = await organizationsController.create(creator.id, {
    name: "Organização Integrada",
  });
  assert(organizationCreation.ok && organizationCreation.data.isOwner,
    "A organização não atribuiu a propriedade ao criador.");

  const creation = await workspacesController.createInOrganization(creator.id, {
    name: "Workspace Integrada",
    organizationId: organizationCreation.data.id,
  });
  assert(creation.ok, "A criação da workspace falhou.");
  const workspace = creation.data;
  assert(workspace.isOwner, "O criador não recebeu superadmin.");
  assert(workspace.pageRootId === workspace.id, "A root do criador deve manter o id da workspace.");

  const creatorRoot = await workspacesController.getPageRoot(workspace.id, creator.id);
  assert(creatorRoot?.id === workspace.id && creatorRoot.owner_id === creator.id,
    "A root do criador não respeita id/owner_id.");

  const secondWorkspace = await workspacesController.createInOrganization(creator.id, {
    name: "Workspace Integrada Dois",
    organizationId: organizationCreation.data.id,
  });
  assert(secondWorkspace.ok && secondWorkspace.data.organizationId === organizationCreation.data.id,
    "A segunda workspace não foi criada dentro da organização.");

  const readerTemplate=await roleStore.save("workspace",workspace.id,creator.id,{name:"Leitura",roles:{read:["view"],write:[]}});
  const managerTemplate=await roleStore.save("workspace",workspace.id,creator.id,{name:"Gestão",roles:fullPermissions("workspace")});
  assert(readerTemplate && managerTemplate,"Não foi possível criar templates.");

  const inviteToken = createOpaqueToken("cubs_invite_v1_");
  const inviteId = ulid();
  assert(await accessInviteStore.create({
    id: inviteId,
    tokenHash: hashOpaqueToken(inviteToken),
    tokenHint: opaqueTokenHint(inviteToken),
    scope: "workspace",
    scopeId: workspace.id,
    roleId: readerTemplate.id,
    recipientEmail: member.email,
    authorId: creator.id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    acceptanceLimit: 1,
  }), "Não foi possível criar o convite da workspace.");
  assert(await accessInviteStore.acceptByTokenHash(hashOpaqueToken(inviteToken), member.id),
    "O convite da workspace não foi aceito.");
  const joined = await workspaceStore.getForUser(workspace.id, member.id);
  assert(joined?.isMember && !joined.isOwner, "O usuário não entrou como member pelo convite.");
  assert(joined.pageRootId !== workspace.id,
    "O membro precisa receber uma root própria para evitar colisão de PK.");
  const memberRoot = await workspacesController.getPageRoot(workspace.id, member.id);
  assert(memberRoot?.id === joined.pageRootId && memberRoot.owner_id === member.id,
    "A root do membro não respeita o vínculo/owner_id.");
  const protectedAdmin = await workspacesController.updateMemberRole(
    workspace.id,
    creator.id,
    creator.id,
    readerTemplate.id,
  );
  assert(!protectedAdmin.ok && protectedAdmin.reason === "forbidden",
    "Foi possível remover o último superadmin.");

  const promoted = await workspacesController.updateMemberRole(
    workspace.id,
    creator.id,
    member.id,
    managerTemplate.id,
  );
  assert(promoted.ok, "Não foi possível promover o membro.");
  const demoted = await workspacesController.updateMemberRole(
    workspace.id,
    creator.id,
    creator.id,
    readerTemplate.id,
  );
  assert(!demoted.ok, "Owner não pode ser rebaixado por template.");

  const renamed = await workspacesController.updateSettings(workspace.id, creator.id, {
    name: "Workspace Verificada",
    icon: "cuida:building-outline",
  });
  assert(renamed.ok && renamed.data.icon === "cuida:building-outline",
    "A atualização das configurações falhou.");

  console.log("✓ Fluxo integrado de workspace validado em banco isolado.");
  console.log(`  privateVerification=${privateRegistration.email}`);
  console.log(`  workspace=${workspace.id}`);
  console.log(`  creatorRoot=${workspace.pageRootId}`);
  console.log(`  memberRoot=${joined.data.pageRootId}`);
}

main().catch((error: unknown) => {
  console.error(`[workspace-flow-test] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
