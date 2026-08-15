import { resolveServicePort, ServicePorts } from "@hestia/config";
import { createServiceApp, listen } from "@hestia/service-runtime";

const app = createServiceApp({ service: "policy-service" });
listen(
  app,
  "policy-service",
  resolveServicePort("POLICY_SERVICE_PORT", ServicePorts.policyService),
);
