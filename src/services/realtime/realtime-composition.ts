import { pageEditChannel } from "@/services/realtime/page-edit-channel";
import { pageInteractionChannel } from "@/services/realtime/page-interaction-channel";
import { pageRoomChannel } from "@/services/realtime/page-room-channel";
import { RealtimeChannelRegistry } from "@/services/realtime/realtime-channel-registry";
import { systemChannel } from "@/services/realtime/system-channel";

/** Grafo unico de channels do processo. O registry valida ownership no import. */
export const realtimeChannelRegistry = new RealtimeChannelRegistry([
  systemChannel,
  pageRoomChannel,
  pageInteractionChannel,
  pageEditChannel,
]);
