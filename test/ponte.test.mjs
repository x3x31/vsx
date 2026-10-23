/**
 * Testes da ponte (server/index.js) na troca de código por token.
 *
 * O modo remoto (GitHub Pages) devolve o token para o navegador e NÃO o
 * grava — um servidor não pode guardar credencial de terceiros. O modo local
 * (app servido pela própria ponte, modelo VS Code) continua guardando.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { startBridge, startMockGithub } from "./helpers.mjs";

let github;
let bridge;

/** Estado que a ponte manda no `state` da autorização (base64url JSON). */
function oauthState(overrides = {}) {
  const payload = {
    v: "verifier-do-navegador",
    r: "http://127.0.0.1:5173/",
    c: "Iv1.ponte",
    u: "http://127.0.0.1:5173/",
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

async function configJson() {
  const file = path.join(bridge.home, ".config", "vsx", "config.json");
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

before(async () => {
  github = await startMockGithub();
  bridge = await startBridge({ github });
});

after(async () => {
  await bridge.stop();
  await github.close();
});

test("a ponte responde que existe e entrega o Client ID", async () => {
  const info = await fetch(`${bridge.url}/api/bridge/info`).then((r) => r.json());
  assert.equal(info.name, "vsx-bridge");
  // no modo local (loopback) não há URL pública nem senha
  assert.equal(info.publicUrl, null);
  assert.equal(info.codespace, false);
  assert.equal(info.requiresSecret, false);

  const config = await fetch(`${bridge.url}/api/oauth/config`).then((r) => r.json());
  assert.equal(config.clientId, "Iv1.ponte");
});

test("modo remoto: o token volta para o navegador e a ponte não o guarda", async () => {
  const res = await fetch(`${bridge.url}/oauth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://x3x31.github.io" },
    body: JSON.stringify({
      code: "TESTCODE",
      state: oauthState(),
      clientId: "Iv1.ponte",
      redirectUri: "http://127.0.0.1:5173/",
      verifier: "verifier-do-navegador",
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://x3x31.github.io");

  const data = await res.json();
  assert.equal(data.token, "gho_broker_token");
  assert.equal(data.scope, "repo");

  // o que a ponte recebeu do GitHub: PKCE e form-encoded
  const sent = github.state.tokenRequests.at(-1);
  assert.equal(sent.code_verifier, "verifier-do-navegador");
  assert.equal(sent.redirect_uri, "http://127.0.0.1:5173/");

  // nada de credencial de terceiros na máquina de quem roda a ponte
  const saved = await configJson();
  assert.equal(saved.token ?? null, null, "a ponte não gravou o token");
  const state = await fetch(`${bridge.url}/api/state`).then((r) => r.json());
  assert.equal(state.connected, false);
});

test("modo local: a autorização volta por navegação e a ponte guarda o próprio login", async () => {
  const state = oauthState({ r: `${bridge.url}/` });
  const url = `${bridge.url}/oauth/callback?code=TESTCODE&state=${encodeURIComponent(state)}`;

  const res = await fetch(url, { redirect: "manual" });
  assert.equal(res.status, 302);

  const location = res.headers.get("location");
  assert.match(location, /^http:\/\/127\.0\.0\.1:\d+\/#vsx_connected=1/);
  assert.match(location, /vsx_login=alice/);

  const saved = await configJson();
  assert.equal(saved.token, "gho_broker_token");
  assert.equal(saved.user?.login, "alice");
});
