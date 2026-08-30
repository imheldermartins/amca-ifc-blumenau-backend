import { describe, expect, it } from "vitest";
import {
  REALTIME_CLIENT_TO_SERVER_EVENT_NAMES,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_SERVER_TO_CLIENT_EVENT_NAMES,
} from "@core/socket/realtime-contract-v1";

describe("contrato realtime v1", () => {
  it("congela o inventario publico completo", () => {
    expect(REALTIME_PROTOCOL_VERSION).toBe(1);
    expect(REALTIME_CLIENT_TO_SERVER_EVENT_NAMES).toEqual([
      "echo:send",
      "join-page-database",
      "leave-page-database",
      "resize-column",
    ]);
    expect(REALTIME_SERVER_TO_CLIENT_EVENT_NAMES).toEqual([
      "presence:count",
      "echo:reply",
      "joined-page-database",
      "page-database-denied",
      "page-presence",
      "cell-updated",
      "row-updated",
      "page-updated",
      "column-updated",
      "column-resizing",
      "view-updated",
      "row-created",
      "row-deleted",
      "column-created",
      "column-deleted",
    ]);
  });
});
