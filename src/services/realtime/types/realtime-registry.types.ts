import type { ClientEventName, ServerEventName } from "@/services/realtime/types/realtime-channel.types";

export interface RealtimeProtocolInventory {
  clientEvents: readonly ClientEventName[];
  serverEvents: readonly ServerEventName[];
}
