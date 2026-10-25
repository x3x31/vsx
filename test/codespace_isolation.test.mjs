/**
 * Teste de isolamento e concorrência entre dois Codespaces/alunos (§14.8 item 6).
 * Dois workspaces isolados, com URLs/tokens diferentes, não compartilham
 * repositórios, usuário ou estado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBridge, startMockGithub, startStaticServer } from "./helpers.mjs";

test("dois alunos em Codespaces isolados não compartilham repositório/token/terminal", async () => {
  const github1 = await startMockGithub({ user: { login: "aluno1" }, token: "tok-aluno1" });
  const github2 = await startMockGithub({ user: { login: "aluno2" }, token: "tok-aluno2" });
  const site = await startStaticServer();

  const bridge1 = await startBridge({
    github: github1,
    secret: "seg1",
    env: {
      HOST: "0.0.0.0",
      CODESPACES: "true",
      CODESPACE_NAME: "aluno1-vsx",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
      BRIDGE_SECRET: "seg1",
      CORS_ORIGINS: site.url,
      GITHUB_TOKEN: "tok-aluno1",
    },
  });
  const bridge2 = await startBridge({
    github: github2,
    secret: "seg2",
    env: {
      HOST: "0.0.0.0",
      CODESPACES: "true",
      CODESPACE_NAME: "aluno2-vsx",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
      BRIDGE_SECRET: "seg2",
      CORS_ORIGINS: site.url,
      GITHUB_TOKEN: "tok-aluno2",
    },
  });

  // conectar cada um ao seu próprio workspace
  const c1 = await fetch(`${bridge1.url}/api/github/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vsx-secret": "seg1" },
    body: JSON.stringify({ token: "tok-aluno1" }),
  });
  const c2 = await fetch(`${bridge2.url}/api/github/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vsx-secret": "seg2" },
    body: JSON.stringify({ token: "tok-aluno2" }),
  });
  assert.equal(c1.status, 200);
  assert.equal(c2.status, 200);
  const u1 = await c1.json();
  const u2 = await c2.json();
  assert.equal(u1.user.login, "aluno1");
  assert.equal(u2.user.login, "aluno2");
  assert.notEqual(u1.user.login, u2.user.login);

  // cada workspace vê apenas seus próprios repositórios
  const r1 = await fetch(`${bridge1.url}/api/github/repos`, { headers: { "x-vsx-secret": "seg1" } });
  const r2 = await fetch(`${bridge2.url}/api/github/repos`, { headers: { "x-vsx-secret": "seg2" } });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const repos1 = (await r1.json()).repos || [];
  const repos2 = (await r2.json()).repos || [];
  // isolamento: não devem vazar repositórios entre workspaces
  for (const repo of repos1) assert.notEqual(repo.owner?.login, "aluno2");
  for (const repo of repos2) assert.notEqual(repo.owner?.login, "aluno1");

  // token do outro não funciona no workspace alheio
  const bad = await fetch(`${bridge2.url}/api/github/repos`, { headers: { "x-vsx-secret": "seg1" } });
  assert.notEqual(bad.status, 200);

  await bridge1.stop();
  await bridge2.stop();
  await github1.close();
  await github2.close();
  await site.close();
});
