import { ulid } from "ulid";
import db from "@models/index";
import authController from "@controllers/auth-controller";
import workspacesController from "@controllers/workspaces-controller";
import organizationsController from "@controllers/organizations-controller";
import workspaceStore from "@db/workspace-store";
import type { Schema } from "@/models/schemas/index";
import {
  WORKSPACE_KEY_ALGORITHM,
  createWorkspaceKey,
  hashWorkspaceKey,
  normalizeWorkspaceEmail,
  workspaceKeyExpiresAt,
  workspaceKeyHint,
} from "@/services/workspace-key";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function issueKey(
  user: Pick<Schema.User, "name" | "email">,
  purpose: Schema.WorkspaceKeyPurpose,
  workspaceId: string | null,
  expiresAt = workspaceKeyExpiresAt(),
): Promise<string> {
  assert(user.name, "Usuário de teste precisa ter nome.");
  const rawKey = createWorkspaceKey();
  const created = await workspaceStore.issueAccessKey({
    id: ulid() as NonEmptyString,
    key_hash: hashWorkspaceKey(rawKey),
    key_hint: workspaceKeyHint(rawKey),
    algorithm_version: WORKSPACE_KEY_ALGORITHM,
    issued_to_name: user.name,
    issued_to_email: normalizeWorkspaceEmail(user.email),
    purpose,
    expires_at: expiresAt,
    consumed_at: null,
    consumed_by_user_id: null,
    revoked_at: null,
  }, workspaceId, workspaceId ? ulid() : null);
  assert(created, `Não foi possível emitir chave ${purpose}.`);
  return rawKey;
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
    password: "segredo123",
  });
  assert(privateRegistration.ok, "O cadastro comum com workspace privada falhou.");
  assert(privateRegistration.workspace.name === "Area de Trabalho do Helder",
    "O cadastro comum não aplicou o nome padrão da workspace.");
  assert(privateRegistration.workspace.role === "superadmin",
    "O cadastro comum não recebeu superadmin.");
  assert(privateRegistration.workspace.pageRootId === privateRegistration.workspace.id,
    "A workspace privada não preservou a root com o mesmo id.");

  const issuedRecipient = {
    name: "Destinatária Original",
    email: `issued-${runId}@workspace.test`,
  };
  const onboardingKey = await issueKey(issuedRecipient, "create", null);
  const onboardingPreview = await authController.previewWorkspaceKey(onboardingKey);
  assert(onboardingPreview.valid
    && onboardingPreview.name === issuedRecipient.name
    && onboardingPreview.email === issuedRecipient.email,
  "O preview público não devolveu o autocomplete emitido.");

  const onboarding = await authController.registerWithWorkspace({
    key: onboardingKey,
    name: "Identidade Editada",
    email: `edited-${runId}@workspace.test`,
    password: "segredo123",
    workspaceName: "Workspace do Onboarding",
  });
  assert(onboarding.ok, "O cadastro público por chave falhou.");
  const consumedOnboardingKey = await workspaceStore.getAccessKey(hashWorkspaceKey(onboardingKey));
  assert(consumedOnboardingKey?.issued_to_name === issuedRecipient.name,
    "O consumo reescreveu a identidade original da chave.");
  assert(consumedOnboardingKey?.consumed_as_name === "Identidade Editada"
    && consumedOnboardingKey.consumed_as_email === `edited-${runId}@workspace.test`
    && consumedOnboardingKey.consumed_by_user_id === onboarding.user.id,
  "O consumo não registrou a identidade final para auditoria.");

  const conflictKey = await issueKey({
    name: "Outra Pessoa",
    email: `other-${runId}@workspace.test`,
  }, "create", null);
  const emailConflict = await authController.registerWithWorkspace({
    key: conflictKey,
    name: "Helder Teste",
    email: privateRegistration.user.email,
    password: "segredo123",
    workspaceName: "Não Deve Nascer",
  });
  assert(!emailConflict.ok && emailConflict.reason === "email_taken",
    "Uma chave foi anexada a uma conta já existente.");
  assert((await authController.previewWorkspaceKey(conflictKey)).valid,
    "O conflito de e-mail consumiu a chave.");

  const racingKey = await issueKey({
    name: "Corrida",
    email: `race-issued-${runId}@workspace.test`,
  }, "create", null);
  const racingResults = await Promise.all([
    authController.registerWithWorkspace({
      key: racingKey,
      name: "Corrida Um",
      email: `race-one-${runId}@workspace.test`,
      password: "segredo123",
      workspaceName: "Workspace Corrida Um",
    }),
    authController.registerWithWorkspace({
      key: racingKey,
      name: "Corrida Dois",
      email: `race-two-${runId}@workspace.test`,
      password: "segredo123",
      workspaceName: "Workspace Corrida Dois",
    }),
  ]);
  assert(racingResults.filter((result) => result.ok).length === 1,
    "A mesma chave criou mais de uma conta/workspace em corrida.");

  const creator = await db.users.create({
    name: "Criadora Teste",
    email: `creator-${runId}@workspace.test`,
  } as CreateValues<Schema.User>);
  const member = await db.users.create({
    name: "Membro Teste",
    email: `member-${runId}@workspace.test`,
  } as CreateValues<Schema.User>);
  assert(creator && member, "Não foi possível criar os usuários de teste.");

  const createKey = await issueKey(creator, "create", null);
  const createValidation = await workspacesController.validateAccessKey(
    createKey,
    creator.id,
    "create",
  );
  assert(createValidation.valid, "A chave de criação válida foi rejeitada.");

  const creation = await workspacesController.createWithKey(creator.id, {
    name: "Workspace Integrada",
    key: createKey,
  });
  assert(creation.ok, "A criação da workspace falhou.");
  const workspace = creation.data;
  assert(workspace.role === "superadmin", "O criador não recebeu superadmin.");
  assert(workspace.pageRootId === workspace.id, "A root do criador deve manter o id da workspace.");
  assert(!(await workspacesController.validateAccessKey(createKey, creator.id)).valid,
    "A chave de criação permaneceu válida depois do consumo.");

  const creatorRoot = await workspacesController.getPageRoot(workspace.id, creator.id);
  assert(creatorRoot?.id === workspace.id && creatorRoot.owner_id === creator.id,
    "A root do criador não respeita id/owner_id.");

  const secondCreateKey = await issueKey(creator, "create", null);
  const secondIndividual = await workspacesController.createWithKey(creator.id, {
    name: "Workspace Individual Indevida",
    key: secondCreateKey,
  });
  assert(!secondIndividual.ok && secondIndividual.reason === "conflict",
    "Foi possível criar uma segunda workspace individual.");

  const organizationCreation = await organizationsController.create(creator.id, {
    name: "Organização Integrada",
    workspaceId: workspace.id,
  });
  assert(organizationCreation.ok && organizationCreation.data.workspaceCount === 1,
    "A organização não vinculou sua primeira workspace.");

  const secondWorkspace = await workspacesController.createWithKey(creator.id, {
    name: "Workspace Integrada Dois",
    key: secondCreateKey,
    organizationId: organizationCreation.data.id,
  });
  assert(secondWorkspace.ok && secondWorkspace.data.organizationId === organizationCreation.data.id,
    "A segunda workspace não foi criada dentro da organização.");

  const expiredJoinKey = await issueKey(
    member,
    "join",
    workspace.id,
    "2000-01-01T00:00:00.000Z",
  );
  assert(!(await workspacesController.validateAccessKey(expiredJoinKey, member.id, "join")).valid,
    "Uma chave expirada foi aceita.");

  // Prova a migration do índice: uma credencial expirada não bloqueia a nova.
  const joinKey = await issueKey(member, "join", workspace.id);
  const joinValidation = await workspacesController.validateAccessKey(joinKey, member.id, "join");
  assert(joinValidation.valid && joinValidation.workspace?.id === workspace.id,
    "A chave de entrada não resolveu a workspace vinculada.");

  const joined = await workspacesController.joinWithKey(member.id, joinKey);
  assert(joined.ok, "A entrada do membro falhou.");
  assert(joined.data.role === "member", "O usuário entrou com role diferente de member.");
  assert(joined.data.pageRootId !== workspace.id,
    "O membro precisa receber uma root própria para evitar colisão de PK.");
  const memberRoot = await workspacesController.getPageRoot(workspace.id, member.id);
  assert(memberRoot?.id === joined.data.pageRootId && memberRoot.owner_id === member.id,
    "A root do membro não respeita o vínculo/owner_id.");

  const protectedAdmin = await workspacesController.updateMemberRole(
    workspace.id,
    creator.id,
    creator.id,
    "member",
  );
  assert(!protectedAdmin.ok && protectedAdmin.reason === "conflict",
    "Foi possível remover o último superadmin.");

  const promoted = await workspacesController.updateMemberRole(
    workspace.id,
    creator.id,
    member.id,
    "superadmin",
  );
  assert(promoted.ok, "Não foi possível promover o membro.");
  const demoted = await workspacesController.updateMemberRole(
    workspace.id,
    creator.id,
    creator.id,
    "member",
  );
  assert(demoted.ok, "Não foi possível trocar o superadmin após a promoção.");

  const renamed = await workspacesController.updateSettings(workspace.id, creator.id, {
    name: "Workspace Verificada",
    icon: "cuida:building-outline",
  });
  assert(renamed.ok && renamed.data.icon === "cuida:building-outline",
    "A atualização das configurações falhou.");

  console.log("✓ Fluxo integrado de workspace validado em banco isolado.");
  console.log(`  privateWorkspace=${privateRegistration.workspace.id}`);
  console.log(`  onboardingWorkspace=${onboarding.workspace.id}`);
  console.log(`  workspace=${workspace.id}`);
  console.log(`  creatorRoot=${workspace.pageRootId}`);
  console.log(`  memberRoot=${joined.data.pageRootId}`);
}

main().catch((error: unknown) => {
  console.error(`[workspace-flow-test] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
