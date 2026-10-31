import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import os from "node:os";

export class HttpError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? {});
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

export function sendText(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

export async function readJson(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError("Corpo da requisiÃ§Ã£o muito grande", 413);
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError("JSON invÃ¡lido", 400);
  }
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function randomCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `*` casa com qualquer trecho; a comparaÃ§Ã£o Ã© feita no host completo. */
export function originAllowed(origin, patterns = []) {
  if (!origin) return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const target = `${parsed.protocol}//${parsed.host}`;
  return patterns.some((pattern) => {
    if (!pattern.includes("*")) return pattern === target || pattern === parsed.host;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(target);
  });
}

export function setCors(res, origin, patterns = []) {
  if (!origin || !originAllowed(origin, patterns)) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, authorization, x-vsx-token, x-vsx-secret, x-eduterminal-token, x-eduterminal-admin, x-github-api-version, accept",
  );
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("access-control-max-age", "86400");
  // Chrome exige esta permissÃ£o para uma origem pÃºblica alcanÃ§ar a rede local.
  if (res.req?.headers?.["access-control-request-private-network"]) {
    res.setHeader("access-control-allow-private-network", "true");
  }
  return true;
}

export function log(...args) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log("[" + stamp + "] [eduterminal]", ...args);
}

export function lanAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        result.push({ name, address: address.address });
      }
    }
  }
  return result;
}

