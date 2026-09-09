import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ulid } from "ulid";
import db from "@models/index";
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

interface Arguments {
  name?: string;
  email?: string;
  purpose?: string;
  workspace?: string;
}

function readArguments(values: string[]): Arguments {
  const args: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token?.startsWith("--")) continue;
    const [rawKey, inline] = token.slice(2).split("=", 2);
    if (!rawKey) continue;
    const next = inline ?? values[index + 1];
    if (inline === undefined && next && !next.startsWith("--")) index += 1;
    if (next && !next.startsWith("--")) args[rawKey] = next;
  }
  return {
    ...(args.name && { name: args.name }),
    ...(args.email && { email: args.email }),
    ...(args.purpose && { purpose: args.purpose }),
    ...(args.workspace && { workspace: args.workspace }),
  };
}

async function main(): Promise<void> {
  const args = readArguments(process.argv.slice(2));
  const terminal = createInterface({ input, output });

  try {
    const name = (args.name ?? await terminal.question("Nome do destinatário: ")).trim();
    const email = normalizeWorkspaceEmail(
      args.email ?? await terminal.question("E-mail do destinatário: "),
    );
    const purposeInput = args.purpose
      ?? (await terminal.question("Finalidade (create/join): ")).trim().toLowerCase();

    if (!name) throw new Error("Nome é obrigatório.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido.");
    if (purposeInput !== "create" && purposeInput !== "join") {
      throw new Error("Finalidade deve ser create ou join.");
    }

    const purpose: Schema.WorkspaceKeyPurpose = purposeInput;
    const workspaceId = purpose === "join"
      ? (args.workspace ?? await terminal.question("ID da workspace: ")).trim()
      : null;

    if (purpose === "join") {
      if (!workspaceId || !/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(workspaceId)) {
        throw new Error("Workspace ID inválido.");
      }
      if (!await db.workspaces.find({ id: workspaceId } as LookupValues<Schema.Workspace>)) {
        throw new Error("Workspace não encontrada.");
      }
    }

    const rawKey = createWorkspaceKey();
    const keyId = ulid();
    const created = await workspaceStore.issueAccessKey({
      id: keyId as NonEmptyString,
      key_hash: hashWorkspaceKey(rawKey),
      key_hint: workspaceKeyHint(rawKey),
      algorithm_version: WORKSPACE_KEY_ALGORITHM,
      issued_to_name: name,
      issued_to_email: email,
      purpose,
      expires_at: workspaceKeyExpiresAt(),
      consumed_at: null,
      consumed_by_user_id: null,
      revoked_at: null,
    }, workspaceId, workspaceId ? ulid() : null);

    if (!created) throw new Error("A chave não foi persistida.");

    console.log("\nChave criada. Copie agora; ela não será exibida novamente:");
    console.log(rawKey);
    console.log(`Destinatário: ${name} <${email}>`);
    console.log(`Finalidade: ${purpose}`);
    if (workspaceId) console.log(`Workspace: ${workspaceId}`);
    console.log("Expira em 7 dias e só pode ser usada uma vez.");
  } finally {
    terminal.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Falha ao criar chave.");
  process.exitCode = 1;
});
