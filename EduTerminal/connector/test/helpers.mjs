import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEduTerminalServer } from "../src/server.mjs";

export async function tempDir(prefix = "eduterminal-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function startServer(overrides = {}) {
  const dir = await tempDir();
  const server = createEduTerminalServer({
    config: {
      port: 0,
      host: "127.0.0.1",
      configDir: path.join(dir, "config"),
      workspaceDir: path.join(dir, "workspaces"),
      autoApprove: true,
      ...overrides.config,
    },
    ...overrides,
  });
  const address = await server.listen();
  const base = `http://127.0.0.1:${address.port}`;
  return { server, base, dir };
}

export async function pairToken(base) {
  const start = await fetch(`${base}/api/eduterminal/pairing/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "teste" }),
  });
  const code = await start.json();
  const request = await fetch(`${base}/api/eduterminal/pair/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.code, name: "teste" }),
  });
  const payload = await request.json();
  return { token: payload.token, requestId: payload.requestId, code };
}

export async function api(base, path, { token, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { "x-vsx-secret": token } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { text };
  }
  return { status: res.status, payload };
}

export function fakeOpenCode() {
  const session = { id: "ses_test", title: "teste" };
  return {
    running: true,
    url: "http://127.0.0.1:9999",
    unavailableReason: null,
    async start() {
      return this.url;
    },
    stop() {},
    async info() {
      return { version: "test" };
    },
    async models() {
      return [{ id: "model" }];
    },
    async agents() {
      return [{ id: "agent" }];
    },
    async sessionFor() {
      return session;
    },
    async listSessions() {
      return [session];
    },
    async deleteSession() {
      return { ok: true };
    },
    forgetSession() {},
    async prompt() {
      return { ok: true };
    },
    async interrupt() {
      return { ok: true };
    },
    async permissions() {
      return [];
    },
    async replyPermission() {
      return { ok: true };
    },
    async setModel() {
      return { ok: true };
    },
    async setAgent() {
      return { ok: true };
    },
    async messages() {
      return [];
    },
    async events() {
      return { ok: false, status: 503 };
    },
  };
}
