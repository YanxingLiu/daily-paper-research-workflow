import { timingSafeEqual } from "node:crypto";

export type HeaderMap = Record<string, string | string[] | undefined>;

export function getAdminAuthError(
  headers: HeaderMap,
  adminToken: string | undefined,
  options: { requireConfiguredToken?: boolean } = {}
): { status: number; message: string } | null {
  if (!adminToken) {
    return options.requireConfiguredToken
      ? { status: 503, message: "PAPERS_EASY_ADMIN_TOKEN must be configured before MCP access is enabled" }
      : null;
  }

  const providedToken = readAdminToken(headers);
  if (!providedToken) {
    return { status: 401, message: "Missing admin token" };
  }

  if (!safeTokenEquals(providedToken, adminToken)) {
    return { status: 403, message: "Invalid admin token" };
  }

  return null;
}

export function readAdminToken(headers: HeaderMap): string | undefined {
  const authorization = singleHeader(headers.authorization);
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return singleHeader(headers["x-papers-easy-admin-token"]) ?? singleHeader(headers["x-admin-token"]);
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeTokenEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
