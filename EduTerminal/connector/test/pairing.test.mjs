import assert from "node:assert/strict";
import test from "node:test";
import { api, pairToken, startServer } from "./helpers.mjs";

test("pareamento: código vira token e token protege a API", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { token } = await pairToken(base);
  assert.ok(token, "o pareamento deve devolver um token");

  const withoutToken = await api(base, "/api/state");
  assert.equal(withoutToken.status, 401);

  const withToken = await api(base, "/api/state", { token });
  assert.equal(withToken.status, 200);
  assert.equal(withToken.payload.eduterminal, true);

  const info = await api(base, "/api/bridge/info", { token });
  assert.equal(info.status, 200);
  assert.equal(info.payload.name, "vsx-bridge");
  assert.equal(info.payload.eduterminal, true);
  assert.equal(info.payload.requiresSecret, true);
});

test("pareamento: exige autorização explícita quando autoApprove está desligado", async (t) => {
  const { server, base } = await startServer({ config: { autoApprove: false } });
  t.after(() => server.close());

  const start = await api(base, "/api/eduterminal/pairing/start", {
    method: "POST",
    body: { label: "VSX do aluno" },
  });
  assert.equal(start.status, 200);
  assert.match(start.payload.code, /^\d{6}$/);

  const request = await api(base, "/api/eduterminal/pair/request", {
    method: "POST",
    body: { code: start.payload.code, name: "VSX" },
  });
  assert.equal(request.status, 200);
  assert.equal(request.payload.status, "pending");
  assert.equal(request.payload.token, null);

  const pending = await api(base, "/api/eduterminal/requests");
  assert.equal(pending.payload.requests.length, 1);

  const statusBefore = await api(
    base,
    `/api/eduterminal/pair/status?requestId=${request.payload.requestId}`,
  );
  assert.equal(statusBefore.payload.status, "pending");

  const approve = await api(base, "/api/eduterminal/pair/approve", {
    method: "POST",
    body: { requestId: request.payload.requestId },
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.payload.status, "approved");
  assert.ok(approve.payload.token);

  const statusAfter = await api(
    base,
    `/api/eduterminal/pair/status?requestId=${request.payload.requestId}`,
  );
  assert.equal(statusAfter.payload.status, "approved");
  assert.equal(statusAfter.payload.token, approve.payload.token);

  const state = await api(base, "/api/state", { token: approve.payload.token });
  assert.equal(state.status, 200);
});

test("pareamento: código errado, usado ou expirado é recusado", async (t) => {
  const { server, base } = await startServer({ config: { autoApprove: false } });
  t.after(() => server.close());

  const bad = await api(base, "/api/eduterminal/pair/request", {
    method: "POST",
    body: { code: "000000", name: "VSX" },
  });
  assert.equal(bad.status, 404);

  const start = await api(base, "/api/eduterminal/pairing/start", {
    method: "POST",
    body: { label: "teste" },
  });
  const code = start.payload.code;

  const first = await api(base, "/api/eduterminal/pair/request", {
    method: "POST",
    body: { code, name: "VSX" },
  });
  assert.equal(first.status, 200);

  const second = await api(base, "/api/eduterminal/pair/request", {
    method: "POST",
    body: { code, name: "outro VSX" },
  });
  assert.equal(second.status, 409);
});

test("pareamento: token pode ser revogado", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { token } = await pairToken(base);
  assert.equal((await api(base, "/api/state", { token })).status, 200);

  const tokens = await api(base, "/api/eduterminal/tokens");
  assert.equal(tokens.payload.tokens.length, 1);

  const revoke = await api(base, "/api/eduterminal/tokens", {
    method: "DELETE",
    body: { id: tokens.payload.tokens[0].id },
  });
  assert.equal(revoke.status, 200);

  assert.equal((await api(base, "/api/state", { token })).status, 401);
});
