import type { RealtimePayload } from "@core/socket/realtime-contract-v1";

export interface RealtimeEventMetadata {
  updatedAt: string;
  originUserId: string;
}

/** Cria metadados autoritativos e permite compartilhar um relogio por lote. */
export class RealtimeEventFactory {
  constructor(private readonly now: () => Date = () => new Date()) {}

  metadata(originUserId: string): RealtimeEventMetadata {
    return {
      originUserId,
      updatedAt: this.now().toISOString(),
    };
  }

  create<T extends { pageId: string }>(
    payload: T,
    metadata: RealtimeEventMetadata,
  ): T & RealtimePayload {
    return { ...payload, ...metadata };
  }
}
