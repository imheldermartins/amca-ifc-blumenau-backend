import { ulid } from "ulid";
import { Schema } from "@/db/schemas/index";
import {
  allocateDuplicateLabel,
  collectReservedPublicKeys,
  normalizePublicKey,
  reconcilePublicKeyMetadata,
} from "@/services/public-key";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const COLOR_OPTIONS = new Set<Schema.ColorOptions>(Schema.COLOR_OPTIONS);

export class PageSelectOptionService {
  public normalize(
    options: readonly unknown[],
    existingOptions: readonly Schema.SelectOption[],
    externallyReserved: ReadonlySet<string> = new Set(),
  ): Schema.SelectOption[] {
    const existingById = new Map(existingOptions.map((option) => [option.id, option]));
    const prepared = options.map((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        throw new Error('Configuração de opções inválida para a coluna "select"');
      }

      const candidate = option as Record<string, unknown>;
      const { id, value, color } = candidate;
      if (typeof value !== "string") {
        throw new Error('Configuração de opções inválida para a coluna "select"');
      }

      let optionId: Schema.SelectOption["id"];
      if (id === undefined || id === null) optionId = ulid() as Schema.SelectOption["id"];
      else if (typeof id === "string" && ULID_RE.test(id)) optionId = id as Schema.SelectOption["id"];
      else throw new Error('Configuração de opções inválida para a coluna "select"');

      if (color !== undefined && !this.isColorOption(color)) {
        throw new Error('Configuração de opções inválida para a coluna "select"');
      }

      return {
        id: optionId,
        value,
        ...(color !== undefined && { color }),
        existing: existingById.get(optionId),
      };
    });

    const labels = prepared
      .filter((option) => option.existing)
      .map((option) => option.value);
    for (const option of prepared) {
      if (!option.existing) option.value = allocateDuplicateLabel(option.value, labels);
      labels.push(option.value);
    }

    const normalized: Schema.SelectOption[] = [];
    for (const option of prepared) {
      const others = [
        ...normalized.map((candidate) => ({
          id: candidate.id,
          label: candidate.value,
          publicKey: candidate.publicKey,
        })),
        ...prepared
          .filter(
            (candidate) =>
              candidate.id !== option.id &&
              !normalized.some((item) => item.id === candidate.id),
          )
          .map((candidate) => ({
            id: candidate.id,
            label: candidate.value,
            publicKey: candidate.existing?.publicKey,
          })),
      ];
      const publicKey = reconcilePublicKeyMetadata(
        option.value,
        "opcao",
        option.existing?.publicKey,
        new Set([...collectReservedPublicKeys(others, "opcao"), ...externallyReserved]),
        {
          forceRename:
            !!option.existing &&
            normalizePublicKey(option.existing.value, "opcao") !==
              normalizePublicKey(option.value, "opcao"),
        },
      );
      normalized.push({
        id: option.id,
        value: option.value,
        ...(option.color !== undefined && { color: option.color }),
        publicKey,
      });
    }

    return normalized;
  }

  private isColorOption(value: unknown): value is Schema.ColorOptions {
    return typeof value === "string" && COLOR_OPTIONS.has(value as Schema.ColorOptions);
  }
}

export default new PageSelectOptionService();
