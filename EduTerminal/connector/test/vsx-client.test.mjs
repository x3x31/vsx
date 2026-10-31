import assert from "node:assert/strict";
import test from "node:test";
import { EduTerminalClient, normalizeEduTerminalUrl } from "../../../js/eduterminal.js";
import { api, startServer } from "./helpers.mjs";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

test("cliente do VSX: normaliza endereços do EduTerminal", () => {
  assert.equal(normalizeEduTerminalUrl("192.168.0.10:8765"), "http://192.168.0.10:8765");
  assert.equal(normalizeEduTerminalUrl("http://192.168.0.10:8765/"), "http://192.168.0.10:8765");
  assert.equal(normalizeEduTerminalUrl(" https://eduterminal.local:8765 "), "https://eduterminal.local:8765");
  assert.equal(normalizeEduTerminalUrl(""), "");
});

test("cliente do VSX: pareia, guarda o token e consulta o connector", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const start = await api(base, "/api/eduterminal/pairing/start", {
    method: "POST",
    body: { label: "vsx-test" },
  });
  const code = start.payload.code;

  const client = new EduTerminalClient();
  client.clear();

  const health = await client.health(base);
  assert.equal(health.name, "eduterminal");

  const request = await client.requestPairing({ url: base, code, name: "VSX teste" });
  assert.equal(request.status, "approved");
  assert.ok(request.token);

  const info = await client.connect({ url: base, token: request.token, name: "VSX teste" });
  assert.equal(info.name, "vsx-bridge");
  assert.equal(client.connected, true);
  assert.equal(client.saved.url, base);

  const status = await client.status();
  assert.equal(status.version, "0.1.0");
  const tools = await client.tools();
  assert.ok(tools.some((tool) => tool.id === "node"));

  client.clear();
  assert.equal(client.connected, false);
  assert.equal(new EduTerminalClient().connected, false);
});

test("cliente do VSX: espera a aprovação explícita no dispositivo", async (t) => {
  const { server, base } = await startServer({ config: { autoApprove: false } });
  t.after(() => server.close());

  const start = await api(base, "/api/eduterminal/pairing/start", {
    method: "POST",
    body: { label: "vsx-manual" },
  });
  const code = start.payload.code;

  const client = new EduTerminalClient();
  client.clear();
  const request = await client.requestPairing({ url: base, code, name: "VSX manual" });
  assert.equal(request.status, "pending");
  assert.equal(request.token, null);

  const seen = [];
  const waiting = client.waitForApproval({
    url: base,
    requestId: request.requestId,
    interval: 80,
    timeout: 5000,
    onStatus: (value) => seen.push(value),
  });

  await new Promise((resolve) => setTimeout(resolve, 120));
  const approve = await api(base, "/api/eduterminal/pair/approve", {
    method: "POST",
    body: { requestId: request.requestId },
  });
  assert.equal(approve.status, 200);

  const approved = await waiting;
  assert.equal(approved.status, "approved");
  assert.ok(approved.token);
  assert.ok(seen.includes("pending"));
  assert.equal((await client.verify({ url: base, token: approved.token })).requiresSecret, false);
});

test("cliente do VSX: recusa no dispositivo vira erro claro", async (t) => {
  const { server, base } = await startServer({ config: { autoApprove: false } });
  t.after(() => server.close());

  const start = await api(base, "/api/eduterminal/pairing/start", {
    method: "POST",
    body: { label: "vsx-deny" },
  });

  const client = new EduTerminalClient();
  client.clear();
  const request = await client.requestPairing({
    url: base,
    code: start.payload.code,
    name: "VSX recusado",
  });

  const waiting = client.waitForApproval({
    url: base,
    requestId: request.requestId,
    interval: 80,
    timeout: 5000,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await api(base, "/api/eduterminal/pair/deny", {
    method: "POST",
    body: { requestId: request.requestId },
  });

  await assert.rejects(waiting, /recusada/i);
});

test("cliente do VSX: token inválido não conecta", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const client = new EduTerminalClient();
  client.clear();
  const info = await client.verify({ url: base, token: "token-errado" });
  assert.equal(info.requiresSecret, true);
  await assert.rejects(
    client.connect({ url: base, token: "token-errado", name: "VSX" }),
    /recusou o token/i,
  );
});
