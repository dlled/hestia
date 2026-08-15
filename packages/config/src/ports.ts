export const ServicePorts = {
  web: 5173,
  edgeApi: 3000,
  homeCore: 3001,
  integrationHub: 3002,
  automationService: 3003,
  aiOrchestrator: 3004,
  policyService: 3005,
  notificationService: 3006,
  identity: 3007,
  modelGateway: 3008,
  mcpGateway: 3009,
} as const;

export function resolveServicePort(
  serviceVariable: string,
  fallback: number,
  source: NodeJS.ProcessEnv = process.env,
): number {
  const raw = source.PORT ?? source[serviceVariable];
  if (raw === undefined) {
    return fallback;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid service port in PORT or ${serviceVariable}`);
  }
  return port;
}
