export const CORRELATION_HEADER = "x-correlation-id";

export function readCorrelationId(headers: {
  get?(name: string): string | null | undefined;
  [key: string]: unknown;
}): string | undefined {
  if (typeof headers.get === "function") {
    return headers.get(CORRELATION_HEADER) ?? undefined;
  }
  const value = headers[CORRELATION_HEADER];
  return typeof value === "string" ? value : undefined;
}
