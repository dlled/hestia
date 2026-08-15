export const TaskQueues = {
  ai: "hestia-ai",
  deviceIo: "hestia-device-io",
  integrations: "hestia-integrations",
  notifications: "hestia-notifications",
  automation: "hestia-automation",
  heavyCompute: "hestia-heavy-compute",
} as const;

export type TaskQueue = (typeof TaskQueues)[keyof typeof TaskQueues];
