import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { createHomeAssistantClient } from "../client.js";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

describe("Home Assistant REST client", () => {
  it("calls a service with bearer authentication and validates changed states", async () => {
    const server = createServer((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/api/services/light/turn_off");
      expect(request.headers.authorization).toBe("Bearer secret-token");
      let body = "";
      request.on("data", (chunk) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        expect(JSON.parse(body)).toEqual({ entity_id: "light.bedroom" });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ changed_states: [state("light.bedroom", "off")] }));
      });
    });
    const baseUrl = await listen(server);
    closeCallbacks.push(() => closeServer(server));
    const client = createHomeAssistantClient({ baseUrl, accessToken: "secret-token" });

    await expect(
      client.callService("light", "turn_off", { entity_id: "light.bedroom" }),
    ).resolves.toMatchObject([{ entity_id: "light.bedroom", state: "off" }]);
  });

  it("authenticates with a bearer token and validates state payloads", async () => {
    const server = createServer((request, response) => {
      expect(request.headers.authorization).toBe("Bearer secret-token");
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/") {
        response.end(JSON.stringify({ message: "API running." }));
        return;
      }
      response.end(JSON.stringify([state("light.bedroom", "on")]));
    });
    const baseUrl = await listen(server);
    closeCallbacks.push(() => closeServer(server));
    const client = createHomeAssistantClient({ baseUrl, accessToken: "secret-token" });

    await expect(client.connect()).resolves.toEqual({ baseUrl, connected: true });
    await expect(client.getStates()).resolves.toMatchObject([
      { entity_id: "light.bedroom", state: "on" },
    ]);
  });

  it("rejects malformed state payloads at the boundary", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{ entity_id: "invalid" }]));
    });
    const baseUrl = await listen(server);
    closeCallbacks.push(() => closeServer(server));
    const client = createHomeAssistantClient({ baseUrl, accessToken: "secret-token" });

    await expect(client.getStates()).rejects.toThrow();
  });
});

describe("Home Assistant WebSocket client", () => {
  it("discovers area, device, and entity registries on one authenticated session", async () => {
    const server = createServer();
    const websocket = new WebSocketServer({ server, path: "/api/websocket" });
    const baseUrl = await listen(server);
    closeCallbacks.push(async () => {
      await new Promise<void>((resolve) => websocket.close(() => resolve()));
      await closeServer(server);
    });
    websocket.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "auth_required" }));
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { id?: number; type: string };
        if (message.type === "auth") {
          socket.send(JSON.stringify({ type: "auth_ok" }));
          return;
        }
        const results: Record<string, unknown> = {
          "config/area_registry/list": [{ area_id: "bedroom", name: "Bedroom" }],
          "config/device_registry/list": [
            {
              id: "device-1",
              name: "Bedside bulb",
              area_id: "bedroom",
              manufacturer: "Acme",
              model: "A1",
              primary_config_entry: "hue",
            },
          ],
          "config/entity_registry/list": [
            {
              entity_id: "light.bedroom",
              name: null,
              platform: "hue",
              device_id: "device-1",
              area_id: null,
              disabled_by: null,
            },
          ],
        };
        socket.send(
          JSON.stringify({
            id: message.id,
            type: "result",
            success: true,
            result: results[message.type],
          }),
        );
      });
    });
    const client = createHomeAssistantClient({ baseUrl, accessToken: "secret-token" });

    await expect(client.getRegistries()).resolves.toMatchObject({
      areas: [{ area_id: "bedroom" }],
      devices: [{ id: "device-1" }],
      entities: [{ entity_id: "light.bedroom" }],
    });
    await client.disconnect();
  });

  it("performs authentication and emits validated state_changed events", async () => {
    const server = createServer();
    const websocket = new WebSocketServer({ server, path: "/api/websocket" });
    const baseUrl = await listen(server);
    closeCallbacks.push(async () => {
      await new Promise<void>((resolve) => websocket.close(() => resolve()));
      await closeServer(server);
    });
    websocket.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "auth_required", ha_version: "2026.8.0" }));
      socket.once("message", (auth) => {
        expect(JSON.parse(auth.toString())).toEqual({
          type: "auth",
          access_token: "secret-token",
        });
        socket.send(JSON.stringify({ type: "auth_ok", ha_version: "2026.8.0" }));
        socket.once("message", (subscribe) => {
          const request = JSON.parse(subscribe.toString()) as { id: number };
          socket.send(
            JSON.stringify({ id: request.id, type: "result", success: true, result: null }),
          );
          socket.send(
            JSON.stringify({
              id: request.id,
              type: "event",
              event: {
                event_type: "state_changed",
                data: {
                  entity_id: "light.bedroom",
                  old_state: state("light.bedroom", "off"),
                  new_state: state("light.bedroom", "on"),
                },
                origin: "LOCAL",
                time_fired: "2026-08-14T20:00:00.000Z",
                context: context(),
              },
            }),
          );
        });
      });
    });
    const client = createHomeAssistantClient({ baseUrl, accessToken: "secret-token" });

    const received = new Promise<string>((resolve) => {
      void client.subscribeStateChanges((event) => resolve(event.data.entity_id));
    });

    await expect(received).resolves.toBe("light.bedroom");
    await client.disconnect();
  });
});

function state(entityId: string, value: string) {
  return {
    entity_id: entityId,
    state: value,
    attributes: { friendly_name: "Bedroom lamp", supported_features: 1 },
    last_changed: "2026-08-14T20:00:00.000Z",
    last_updated: "2026-08-14T20:00:00.000Z",
    context: context(),
  };
}

function context() {
  return { id: "context-1", parent_id: null, user_id: null };
}

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
