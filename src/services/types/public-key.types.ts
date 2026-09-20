import type { Schema } from "@/models/schemas/index";

export type PublicKeyFallback = "coluna" | "opcao" | "view";

export interface PublicKeyEntity {
  id: string;
  label: string | null | undefined;
  publicKey?: Schema.PublicKeyMetadata | null | undefined;
}
