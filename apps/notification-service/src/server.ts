import { resolveServicePort, ServicePorts } from "@hestia/config";
import { createServiceApp, listen } from "@hestia/service-runtime";

const app = createServiceApp({ service: "notification-service" });
listen(
  app,
  "notification-service",
  resolveServicePort("NOTIFICATION_SERVICE_PORT", ServicePorts.notificationService),
);
