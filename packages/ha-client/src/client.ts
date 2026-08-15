import WebSocket from "ws";
import { z } from "zod";
import {
  type HomeAssistantRegistrySnapshot,
  HomeAssistantRegistrySnapshotSchema,
  type HomeAssistantState,
  type HomeAssistantStateChangedEvent,
  HomeAssistantStatesSchema,
  HomeAssistantWebSocketEventSchema,
} from "./schemas.js";

const ApiProbeSchema = z.object({ message: z.string() }).passthrough();
const ServiceResponseSchema = z.union([
  HomeAssistantStatesSchema,
  z.object({ changed_states: HomeAssistantStatesSchema }),
]);
const AuthenticationMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth_required"), ha_version: z.string().optional() }),
  z.object({ type: z.literal("auth_ok"), ha_version: z.string().optional() }),
  z.object({ type: z.literal("auth_invalid"), message: z.string() }),
]);
const SubscriptionResultSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal("result"),
  success: z.boolean(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
const CommandResultSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal("result"),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.union([z.string(), z.number()]), message: z.string() }).optional(),
});

export interface HomeAssistantConnection {
  baseUrl: string;
  connected: boolean;
}

export interface HomeAssistantStateSubscription {
  close(): Promise<void>;
}

export interface HomeAssistantClient {
  connect(): Promise<HomeAssistantConnection>;
  getStates(): Promise<HomeAssistantState[]>;
  callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<HomeAssistantState[]>;
  getRegistries(): Promise<HomeAssistantRegistrySnapshot>;
  subscribeStateChanges(
    handler: (event: HomeAssistantStateChangedEvent) => Promise<void> | void,
  ): Promise<HomeAssistantStateSubscription>;
  disconnect(): Promise<void>;
}

export interface HomeAssistantClientOptions {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof globalThis.fetch;
  createWebSocket?: (url: string) => WebSocket;
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number };
}

export function createHomeAssistantClient(
  options: HomeAssistantClientOptions,
): HomeAssistantClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (options.accessToken.trim() === "") {
    throw new Error("Home Assistant access token is required");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
  const subscriptions = new Set<ReconnectableSubscription>();
  let connected = false;

  return {
    async connect() {
      await requestJson(baseUrl, options.accessToken, "/api/", ApiProbeSchema, fetchImpl);
      connected = true;
      return { baseUrl, connected };
    },
    async getStates() {
      const states = await requestJson(
        baseUrl,
        options.accessToken,
        "/api/states",
        HomeAssistantStatesSchema,
        fetchImpl,
      );
      connected = true;
      return states;
    },
    async getRegistries() {
      const registries = await requestRegistries(
        toWebSocketUrl(baseUrl),
        options.accessToken,
        createWebSocket,
      );
      connected = true;
      return registries;
    },
    async callService(domain, service, data) {
      if (!/^[a-z0-9_]+$/u.test(domain) || !/^[a-z0-9_]+$/u.test(service)) {
        throw new Error("Invalid Home Assistant service name");
      }
      const result = await requestJson(
        baseUrl,
        options.accessToken,
        `/api/services/${domain}/${service}`,
        ServiceResponseSchema,
        fetchImpl,
        { method: "POST", body: JSON.stringify(data) },
      );
      connected = true;
      return Array.isArray(result) ? result : result.changed_states;
    },
    async subscribeStateChanges(handler) {
      let subscription: ReconnectableSubscription;
      subscription = new ReconnectableSubscription({
        url: toWebSocketUrl(baseUrl),
        accessToken: options.accessToken,
        handler,
        createWebSocket,
        initialDelayMs: options.reconnect?.initialDelayMs ?? 250,
        maxDelayMs: options.reconnect?.maxDelayMs ?? 10_000,
        onClose: () => subscriptions.delete(subscription),
      });
      subscriptions.add(subscription);
      await subscription.start();
      connected = true;
      return subscription;
    },
    async disconnect() {
      await Promise.all([...subscriptions].map((subscription) => subscription.close()));
      subscriptions.clear();
      connected = false;
    },
  };
}

const RegistryCommands = [
  { key: "areas", type: "config/area_registry/list" },
  { key: "devices", type: "config/device_registry/list" },
  { key: "entities", type: "config/entity_registry/list" },
] as const;

function requestRegistries(
  url: string,
  accessToken: string,
  createWebSocket: (url: string) => WebSocket,
): Promise<HomeAssistantRegistrySnapshot> {
  return new Promise((resolve, reject) => {
    const socket = createWebSocket(url);
    const responses: Record<string, unknown> = {};
    let settled = false;
    const timeout = setTimeout(
      () => fail(new Error("Home Assistant registry request timed out")),
      10_000,
    );
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
      socket.close();
    };
    socket.on("error", (error) => fail(error));
    socket.on("close", () => {
      if (!settled) fail(new Error("Home Assistant WebSocket closed during registry discovery"));
    });
    socket.on("message", (raw) => {
      try {
        const payload: unknown = JSON.parse(raw.toString());
        const authentication = AuthenticationMessageSchema.safeParse(payload);
        if (authentication.success) {
          if (authentication.data.type === "auth_required") {
            socket.send(JSON.stringify({ type: "auth", access_token: accessToken }));
          } else if (authentication.data.type === "auth_invalid") {
            fail(new Error(`Home Assistant authentication failed: ${authentication.data.message}`));
          } else {
            RegistryCommands.forEach((command, index) => {
              socket.send(JSON.stringify({ id: index + 1, type: command.type }));
            });
          }
          return;
        }
        const result = CommandResultSchema.safeParse(payload);
        if (!result.success) return;
        const command = RegistryCommands[result.data.id - 1];
        if (!command) return;
        if (!result.data.success) {
          fail(
            new Error(
              `Home Assistant ${command.type} failed: ${result.data.error?.message ?? "unknown error"}`,
            ),
          );
          return;
        }
        responses[command.key] = result.data.result;
        if (Object.keys(responses).length === RegistryCommands.length) {
          const snapshot = HomeAssistantRegistrySnapshotSchema.parse(responses);
          settled = true;
          clearTimeout(timeout);
          resolve(snapshot);
          socket.close(1000, "registry discovery complete");
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid Home Assistant message"));
      }
    });
  });
}

interface SubscriptionOptions {
  url: string;
  accessToken: string;
  handler: (event: HomeAssistantStateChangedEvent) => Promise<void> | void;
  createWebSocket: (url: string) => WebSocket;
  initialDelayMs: number;
  maxDelayMs: number;
  onClose: () => void;
}

class ReconnectableSubscription implements HomeAssistantStateSubscription {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectDelayMs: number;
  private reconnectTimer?: NodeJS.Timeout;
  private nextMessageId = 1;

  constructor(private readonly options: SubscriptionOptions) {
    this.reconnectDelayMs = options.initialDelayMs;
  }

  async start(): Promise<void> {
    await this.open(true);
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.close(1000, "client shutdown");
      });
    }
    this.options.onClose();
  }

  private async open(propagateError: boolean): Promise<void> {
    if (this.stopped) return;
    try {
      await this.authenticateAndSubscribe();
      this.reconnectDelayMs = this.options.initialDelayMs;
    } catch (error) {
      if (propagateError) throw error;
      this.scheduleReconnect();
    }
  }

  private authenticateAndSubscribe(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.options.createWebSocket(this.options.url);
      this.socket = socket;
      const subscriptionId = this.nextMessageId++;
      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      socket.on("error", (error) => fail(error));
      socket.on("close", () => {
        this.socket = undefined;
        if (!settled) fail(new Error("Home Assistant WebSocket closed during setup"));
        if (!this.stopped) this.scheduleReconnect();
      });
      socket.on("message", (raw) => {
        try {
          const payload: unknown = JSON.parse(raw.toString());
          const authentication = AuthenticationMessageSchema.safeParse(payload);
          if (authentication.success) {
            if (authentication.data.type === "auth_required") {
              socket.send(JSON.stringify({ type: "auth", access_token: this.options.accessToken }));
              return;
            }
            if (authentication.data.type === "auth_invalid") {
              fail(
                new Error(`Home Assistant authentication failed: ${authentication.data.message}`),
              );
              socket.close();
              return;
            }
            socket.send(
              JSON.stringify({
                id: subscriptionId,
                type: "subscribe_events",
                event_type: "state_changed",
              }),
            );
            return;
          }

          const result = SubscriptionResultSchema.safeParse(payload);
          if (result.success && result.data.id === subscriptionId) {
            if (!result.data.success) {
              fail(
                new Error(
                  `Home Assistant subscription failed: ${result.data.error?.message ?? "unknown error"}`,
                ),
              );
              socket.close();
              return;
            }
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }

          const event = HomeAssistantWebSocketEventSchema.safeParse(payload);
          if (event.success && event.data.id === subscriptionId) {
            void Promise.resolve(this.options.handler(event.data.event)).catch(() => {
              // The event was delivered. Reconnecting here could duplicate a physical observation.
            });
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Invalid Home Assistant message"));
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.options.maxDelayMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.open(false);
    }, delay);
  }
}

async function requestJson<T>(
  baseUrl: string,
  accessToken: string,
  path: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof globalThis.fetch,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`Home Assistant ${path} failed (${response.status})`);
  return schema.parse(await response.json());
}

function normalizeBaseUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Home Assistant base URL must use http or https");
  }
  return url.toString().replace(/\/$/u, "");
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/api/websocket`;
  return url.toString();
}
