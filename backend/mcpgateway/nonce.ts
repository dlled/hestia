import { APIError } from "encore.dev/api";
import { mcpGatewayDB } from "./db";

export async function consumeRequestStateNonce(input: {
  nonce: string;
  clientId: string;
  operation: string;
}): Promise<void> {
  try {
    await mcpGatewayDB.exec`
      INSERT INTO mcp_request_state_nonce (nonce, client_id, operation)
      VALUES (${input.nonce}, ${input.clientId}, ${input.operation})
    `;
  } catch (error) {
    if (isUniqueViolation(error))
      throw APIError.alreadyExists("MCP request state has already been consumed");
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
