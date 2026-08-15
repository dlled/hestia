import { createRequestStateCodec, type ServerContext } from "@modelcontextprotocol/server";

export interface AutomationRequestState {
  operation: "hestia.automation.start";
  planId: string;
  version: number;
  requestedBy: string;
  nonce: string;
}

export function createHestiaRequestStateCodec(key: Uint8Array) {
  if (key.byteLength < 32) throw new Error("MCP request-state key must contain at least 32 bytes");
  return createRequestStateCodec({
    key,
    ttlSeconds: 300,
    bind: (context: ServerContext) =>
      `${context.mcpReq.method}\0${context.http?.authInfo?.clientId ?? "anonymous"}`,
  });
}
