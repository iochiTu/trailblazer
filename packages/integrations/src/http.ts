import { ConnectorError, type ConnectorFailure } from "./types.js";

export interface JsonRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as application/x-www-form-urlencoded (OAuth token endpoints). */
  form?: Record<string, string>;
  timeoutMs?: number;
}

const clip = (text: string, max = 300) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Maps an HTTP status to what should happen next (see ConnectorError). */
export const failureFor = (status: number): ConnectorFailure =>
  status === 401 || status === 403
    ? "auth"
    : status === 408 || status === 425 || status === 429 || status >= 500
      ? "temporary"
      : "rejected";

/** Turns a network-level failure into a ConnectorError. */
export function unreachable(name: string, error: unknown): ConnectorError {
  // A refused address (private network) will never work; anything else may be a passing problem.
  const refused = error instanceof Error && error.name === "UnsafeUrlError";
  return new ConnectorError(
    refused ? "rejected" : "temporary",
    refused ? `${name}: this address can't be used` : `${name} could not be reached`,
  );
}

/**
 * One HTTP call to a CRM: JSON or form body in, parsed JSON out (null for an empty or non-JSON
 * body). Failures become ConnectorError, with the CRM's own message kept short for the owner.
 * Redirects are refused: no CRM API needs them, and following one could leak credentials.
 */
export async function requestJson<T = unknown>(
  fetchFn: typeof fetch,
  name: string,
  url: string,
  request: JsonRequest = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...request.headers };
  let body: string | undefined;
  if (request.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(request.json);
  } else if (request.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(request.form).toString();
  }

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: request.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs ?? 15_000),
    });
  } catch (error) {
    throw unreachable(name, error);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new ConnectorError(
      failureFor(res.status),
      `${name} answered ${res.status}${text ? `: ${clip(text)}` : ""}`,
      res.status,
    );
  }
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}
