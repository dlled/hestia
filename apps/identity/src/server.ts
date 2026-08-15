import { loadEnv, resolveServicePort, ServicePorts } from "@hestia/config";
import { listen } from "@hestia/service-runtime";
import { createIdentityApp } from "./app.js";

const env = loadEnv();
if (env.HESTIA_ENV === "home-prod" && !(process.env.IDENTITY_SESSION_KEY ?? "")) {
  throw new Error("IDENTITY_SESSION_KEY is required in home-prod");
}

listen(createIdentityApp(), "identity", resolveServicePort("IDENTITY_PORT", ServicePorts.identity));
