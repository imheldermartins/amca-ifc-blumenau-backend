import type { RealtimePayload } from "@/services/realtime/contracts/realtime-contract-v1";
import type { RealtimeEventMetadata } from "@/services/realtime/types/realtime-event.types";
export type { RealtimeEventMetadata } from "@/services/realtime/types/realtime-event.types";

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
