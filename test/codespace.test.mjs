/**
 * A ponte dentro do Codespaces (§14.8, item 2).
 *
 * O Codespace é alcançado pelo GitHub Pages por uma URL pública. A ponte
 * precisa escutar em 0.0.0.0, anunciar a URL certa (formato
 * `<CODESPACE_NAME>-<porta>.<domínio>`) e exigir o token em todas as rotas
 * de API, restringindo o CORS ao Pages e à própria origem pública.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBridge, startMockGithub } from "./helpers.mjs";

const SECRET = "segredo-do-codespace";
const PAGES = "https://x3x31.github.io";
const EVIL = "https://exemplo.invalido";

let github;
let bridge;
let publicUrl;
let publicOrigin;

before(async () => {
  github = await startMockGithub();
  bridge = await startBridge({
    github,
    secret: SECRET,
    env: {
      HOST: "", // deixa a ponte inferir 0.0.0.0 por estar em um Codespace
      CODESPACES: "true",
      CODESPACE_NAME: "aluno-vsx",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
      BRIDGE_SECRET: SECRET,
      VSX_PUBLIC_URL: "",
      CORS_ORIGINS: "",
    },
  });
  publicUrl = `https://aluno-vsx-${bridge.port}.app.github.dev`;
  publicOrigin = new URL(publicUrl).origin;
});

after(async () => {
  await bridge.stop();
  await github.close();
});

test("a ponte anuncia a URL pública no formato do Codespaces", async () => {
  const res = await fetch(`${bridge.url}/api/bridge/info`, {
    headers: { authorization: `Bearer ${SECRET}` },
  });
  assert.equal(res.status, 200);

  const info = await res.json();
  assert.equal(info.name, "vsx-bridge");
  assert.equal(info.version, "1.0.0");
  assert.equal(info.host, "0.0.0.0");
  assert.equal(info.codespace, true);
  assert.equal(info.publicUrl, publicUrl);
  assert.notEqual(info.publicUrl, `https://${bridge.port}-app.github.dev`);
  assert.equal(info.requiresSecret, true);
  assert.ok(info.allowedOrigins.includes(PAGES));
  assert.ok(info.allowedOrigins.includes(publicOrigin));
});

test("sem token, as rotas de API respondem 401", async () => {
  for (const path of ["/api/bridge/info", "/api/state", "/api/opencode/status", "/api/stream"]) {
    const res = await fetch(`${bridge.url}${path}`);
    assert.equal(res.status, 401, `${path} sem token deveria dar 401`);
    const body = await res.json();
    assert.match(body.error, /senha/i);
  }
});

test("o token entra por Authorization, x-vsx-secret e x-vsx-bridge-token", async () => {
  for (const headers of [
    { authorization: `Bearer ${SECRET}` },
    { "x-vsx-secret": SECRET },
    { "x-vsx-bridge-token": SECRET },
  ]) {
    const res = await fetch(`${bridge.url}/api/bridge/info`, { headers });
    assert.equal(res.status, 200, JSON.stringify(headers));
  }

  const wrong = await fetch(`${bridge.url}/api/bridge/info`, {
    headers: { authorization: "Bearer outra-senha" },
  });
  assert.equal(wrong.status, 401);
});

test("o Pages alcança a ponte: CORS liberado só para as origens autorizadas", async () => {
  const allowed = await fetch(`${bridge.url}/api/bridge/info`, {
    headers: { origin: PAGES, authorization: `Bearer ${SECRET}` },
  });
  assert.equal(allowed.headers.get("access-control-allow-origin"), PAGES);
  assert.match(allowed.headers.get("access-control-allow-headers"), /authorization/);
  assert.match(allowed.headers.get("access-control-allow-headers"), /x-vsx-bridge-token/);

  const preflight = await fetch(`${bridge.url}/api/bridge/info`, {
    method: "OPTIONS",
    headers: {
      origin: PAGES,
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), PAGES);

  const blocked = await fetch(`${bridge.url}/api/bridge/info`, {
    headers: { origin: EVIL, authorization: `Bearer ${SECRET}` },
  });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});
