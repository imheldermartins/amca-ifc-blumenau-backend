import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  preview: vi.fn(),
  accept: vi.fn(),
}));

vi.mock("@/services/invitations/invite-token-service", () => ({
  default: doubles,
}));

import inviteController from "@/controllers/invite-controller";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InviteController", () => {
  it("delega a leitura do token sem conhecer hash ou persistência", async () => {
    doubles.preview.mockResolvedValueOnce({ valid: false });

    await expect(inviteController.preview("token")).resolves.toEqual({ valid: false });
    expect(doubles.preview).toHaveBeenCalledWith("token");
  });

  it("delega o aceite com a identidade autenticada", async () => {
    doubles.accept.mockResolvedValueOnce(true);

    await expect(inviteController.accept("token", "user-id")).resolves.toBe(true);
    expect(doubles.accept).toHaveBeenCalledWith("token", "user-id");
  });
});
