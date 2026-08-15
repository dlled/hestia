import { createServiceApp } from "@hestia/service-runtime";

export const IdentityRoles = ["Owner", "Admin", "Member", "Guest", "Service Account"] as const;

export function createIdentityApp() {
  return createServiceApp({
    service: "identity",
    register(app) {
      app.get("/api/v1/identity/manifest", (_request, response) => {
        response.json({
          bootstrap: "local-owner",
          authentication: ["passkey", "local-recovery"],
          roles: IdentityRoles,
          scopeDimensions: ["home", "area", "device", "capability", "time", "risk"],
          serviceTokens: { expiring: true, leastPrivilege: true },
        });
      });
    },
  });
}
