import { pageEditChannel } from "@core/socket/page-edit-channel";
import { pageInteractionChannel } from "@core/socket/page-interaction-channel";
import { pageRoomChannel } from "@core/socket/page-room-channel";
import { RealtimeChannelRegistry } from "@core/socket/realtime-channel-registry";
import { systemChannel } from "@core/socket/system-channel";

/** Grafo unico de channels do processo. O registry valida ownership no import. */
export const realtimeChannelRegistry = new RealtimeChannelRegistry([
  systemChannel,
  pageRoomChannel,
  pageInteractionChannel,
  pageEditChannel,
]);
