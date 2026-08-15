import pino, { type Logger } from "pino";

export function createLogger(service: string): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "password",
        "token",
        "accessToken",
        "apiKey",
        "prompt",
        "completion",
      ],
      remove: true,
    },
  });
}
