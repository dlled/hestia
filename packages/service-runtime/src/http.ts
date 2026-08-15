import {
  createId,
  type HealthResponse,
  type ReadinessCheck,
  type ReadinessResponse,
} from "@hestia/contracts";
import { CORRELATION_HEADER, createLogger } from "@hestia/observability";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { HttpError } from "./errors.js";

const VERSION = "0.1.0";

export interface ServiceAppOptions {
  service: string;
  origin?: string;
  register?: (app: Express) => void;
  readiness?: () => Promise<ReadinessCheck[]>;
}

export function createServiceApp(options: ServiceAppOptions): Express {
  const app = express();
  const logger = createLogger(options.service);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: options.origin ?? process.env.WEB_ORIGIN ?? "http://localhost:5173",
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    const existing = req.header(CORRELATION_HEADER);
    req.headers[CORRELATION_HEADER] = existing ?? createId("corr");
    next();
  });
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({
        correlationId: req.header(CORRELATION_HEADER),
        service: options.service,
      }),
    }),
  );

  app.get("/health", (_req, res) => {
    const body: HealthResponse = {
      status: "ok",
      service: options.service,
      version: VERSION,
      timestamp: new Date().toISOString(),
    };
    res.json(body);
  });

  app.get("/ready", async (_req, res) => {
    const checks = options.readiness ? await options.readiness() : [];
    const status = checks.some((check) => check.status === "down")
      ? "down"
      : checks.some((check) => check.status === "degraded")
        ? "degraded"
        : "ok";
    const body: ReadinessResponse = {
      status,
      service: options.service,
      checks,
      timestamp: new Date().toISOString(),
    };
    res.status(status === "down" ? 503 : 200).json(body);
  });

  app.get("/info", (_req, res) => {
    res.json({
      service: options.service,
      version: VERSION,
      phase: "0-foundation",
    });
  });

  options.register?.(app);

  app.use((req, res) => {
    res.status(404).json({ error: "Not Found", path: req.path });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}

export function listen(app: Express, service: string, port: number, host?: string): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const onListening = (): void => {
    createLogger(service).info({ host, port }, `${service} listening`);
  };
  if (host) {
    app.listen(port, host, onListening);
  } else {
    app.listen(port, onListening);
  }
}
