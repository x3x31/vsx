/**
 * Testes do broker (broker/worker.js): a única parte do OAuth que o
 * navegador não consegue fazer (github.com/login/** não tem CORS).
 *
 * O worker roda em Node dentro do teste; o GitHub é simulado localmente.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockGithub } from "./helpers.mjs";

const worker = (await import("../broker/worker.js")).default;

let github;
let env;

const ORIGIN = "https://x3x31.github.io";

before(async () => {
  github = await startMockGithub();
  env = {
    VSX_CLIENT_ID: "Iv1.teste",
    VSX_ALLOWED_ORIGINS: ORIGIN,
    VSX_GITHUB_TOKEN_URL: github.tokenUrl,
    VSX_GITHUB_USER_URL: github.userUrl,
  };
});

after(async () => {
  await github.close();
});

function call(path, { method = "GET", origin = ORIGIN, body } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://broker.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

test("GET /oauth/config entrega o Client ID do vsx com CORS", async () => {
  const res = await call("/oauth/config");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  const data = await res.json();
  assert.equal(data.name, "vsx-broker");
  assert.equal(data.clientId, "Iv1.teste");
});

test("POST /oauth/exchange troca o código por token e devolve para o navegador", async () => {
  const res = await call("/oauth/exchange", {
    method: "POST",
    body: {
      code: "TESTCODE",
      clientId: "Iv1.teste",
      redirectUri: "https://x3x31.github.io/vsx/",
      verifier: "verifier-do-navegador",
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);

  const data = await res.json();
  assert.equal(data.token, "gho_broker_token");
  assert.equal(data.scope, "repo");
  assert.equal(data.login, "alice", "devolve o login para a página mostrar quem conectou");

  // o que chegou ao GitHub: form-encoded, com PKCE e sem client_secret
  const sent = github.state.tokenRequests.at(-1);
  assert.equal(sent.code, "TESTCODE");
  assert.equal(sent.client_id, "Iv1.teste");
  assert.equal(sent.redirect_uri, "https://x3x31.github.io/vsx/");
  assert.equal(sent.code_verifier, "verifier-do-navegador");
  assert.equal(sent.client_secret, undefined, "sem client_secret: o fluxo usa PKCE");
});

test("POST /oauth/exchange repassa o client_secret quando ele está configurado", async () => {
  const anterior = env.VSX_CLIENT_SECRET;
  env.VSX_CLIENT_SECRET = "segredo-so-no-broker";
  try {
    const res = await call("/oauth/exchange", {
      method: "POST",
      body: { code: "TESTCODE", redirectUri: "https://x3x31.github.io/vsx/" },
    });
    assert.equal(res.status, 200);
    const sent = github.state.tokenRequests.at(-1);
    assert.equal(sent.client_secret, "segredo-so-no-broker");
  } finally {
    env.VSX_CLIENT_SECRET = anterior;
  }
});

test("origem fora da lista não é autorizada", async () => {
  const res = await call("/oauth/exchange", {
    method: "POST",
    origin: "https://site-de-alguem.com",
    body: { code: "TESTCODE" },
  });
  assert.equal(res.status, 403);
});

test("preflight OPTIONS devolve 204 com CORS", async () => {
  const res = await call("/oauth/exchange", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
});

test("erro do GitHub vira 400 com a descrição", async () => {
  const res = await call("/oauth/exchange", {
    method: "POST",
    body: { code: "CODIGO_ERRADO" },
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.code, "bad_verification_code");
  assert.match(data.error, /código inválido/);
});

test("sem código a troca é recusada", async () => {
  const res = await call("/oauth/exchange", { method: "POST", body: {} });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Codigo de autorizacao ausente/);
});

test("sem Client ID o broker explica o que falta", async () => {
  const semId = { ...env, VSX_CLIENT_ID: "" };
  const res = await worker.fetch(
    new Request("https://broker.test/oauth/exchange", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ code: "TESTCODE" }),
    }),
    semId,
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /VSX_CLIENT_ID/);
});

test("entende a resposta form-encoded que o GitHub devolve sem Accept", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/login/oauth/access_token")) {
      return new Response("access_token=gho_form&scope=repo&token_type=bearer", {
        status: 200,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
    }
    return real(url, init);
  };
  try {
    const res = await call("/oauth/exchange", { method: "POST", body: { code: "TESTCODE" } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.token, "gho_form");
    assert.equal(data.scope, "repo");
  } finally {
    globalThis.fetch = real;
  }
});

test("rota desconhecida responde 404", async () => {
  const res = await call("/outra/rota");
  assert.equal(res.status, 404);
});
