import request from "supertest";
import { describe, expect, it } from "vitest";
import { createIdentityApp, IdentityRoles } from "../app.js";

describe("identity service archetype", () => {
  it("publishes its local identity contract", async () => {
    const response = await request(createIdentityApp())
      .get("/api/v1/identity/manifest")
      .expect(200);
    expect(response.body.roles).toEqual(IdentityRoles);
    expect(response.body.authentication).toEqual(["passkey", "local-recovery"]);
    expect(response.body.serviceTokens).toEqual({ expiring: true, leastPrivilege: true });
  });
});
