import { describe, expect, it } from "vitest";

import { Schema } from "@/models/schemas/index";

describe("Schema.COLOR_OPTIONS", () => {
  it("aceita green, pink, orange e purple no contrato persistido", () => {
    expect(Schema.COLOR_OPTIONS).toEqual(
      expect.arrayContaining(["green", "pink", "orange", "purple"]),
    );
  });
});
