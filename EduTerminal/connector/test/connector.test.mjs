import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { api, fakeOpenCode, pairToken, startServer } from "./helpers.mjs";

test("workspace: abre pasta local, lê e grava arquivos", async (t) => {
  const { server, base, dir } = await startServer();
  t.after(() => server.close());

  const { token } = await pairToken(base);
  const workspace = path.join(dir, "projeto");
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "README.md"), "# projeto\n", "utf8");

  const opened = await api(base, "/api/workspace/open", {
    token,
    method: "POST",
    body: { path: workspace },
  });
  assert.equal(opened.status, 200);
  assert.equal(opened.payload.repo.path, workspace);
  assert.ok(opened.payload.files.some((file) => file.path === "README.md"));

  const written = await api(base, "/api/workspace/file", {
    token,
    method: "PUT",
    body: { path: "src/app.js", content: "console.log('ok');\n" },
  });
  assert.equal(written.status, 200);

  const read = await api(
    base,
    `/api/workspace/file?path=${encodeURIComponent("src/app.js")}`,
    { token },
  );
  assert.equal(read.status, 200);
  assert.equal(read.payload.content, "console.log('ok');\n");

  const files = await api(base, "/api/workspace/files", { token });
  assert.ok(files.payload.files.some((file) => file.path === "src/app.js"));

  const traversal = await api(base, "/api/workspace/file", {
    token,
    method: "PUT",
    body: { path: "../fora.txt", content: "x" },
  });
  assert.equal(traversal.status, 403);
});

test("workspace: API exige token", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const response = await api(base, "/api/workspace/files");
  assert.equal(response.status, 401);
});

test("tools: lista ferramentas e marca o Node como instalado", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { token } = await pairToken(base);
  const tools = await api(base, "/api/eduterminal/tools", { token });
  assert.equal(tools.status, 200);
  const node = tools.payload.tools.find((tool) => tool.id === "node");
  assert.ok(node);
  assert.equal(node.installed, true);
});

test("opencode: encaminha status, sessão e prompt para o servidor local", async (t) => {
  const opencode = fakeOpenCode();
  const { server, base, dir } = await startServer({ opencode });
  t.after(() => server.close());

  const { token } = await pairToken(base);
  const workspace = path.join(dir, "repo");
  await fs.mkdir(workspace, { recursive: true });
  await api(base, "/api/workspace/open", {
    token,
    method: "POST",
    body: { path: workspace },
  });

  const status = await api(base, "/api/opencode/status", { token });
  assert.equal(status.status, 200);
  assert.equal(status.payload.running, true);

  const session = await api(base, "/api/opencode/session", { token });
  assert.equal(session.status, 200);
  assert.equal(session.payload.session.id, "ses_test");
  assert.deepEqual(session.payload.models, [{ id: "model" }]);

  const prompt = await api(base, "/api/opencode/prompt", {
    token,
    method: "POST",
    body: { text: "leia o README" },
  });
  assert.equal(prompt.status, 200);
  assert.equal(prompt.payload.session.id, "ses_test");
});

test("GitHub: sem token do VSX responde 401", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { token } = await pairToken(base);
  const response = await api(base, "/api/github/repos", { token });
  assert.equal(response.status, 401);
  assert.match(response.payload.error, /token/i);
});

test("health e página inicial são públicas", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.name, "eduterminal");

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /EduTerminal/);
});

test("VSX é servido na mesma origem do connector", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const redirect = await fetch(`${base}/vsx`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/vsx/");

  const page = await fetch(`${base}/vsx/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /__EDUTERMINAL_LOCAL__/);
  assert.match(html, /\.\/js\/main\.js/);

  const main = await fetch(`${base}/vsx/js/main.js`);
  assert.equal(main.status, 200);
  assert.match(main.headers.get("content-type"), /javascript/);
  assert.match(await main.text(), /saveEduTerminalConnection/);

  const escape = await fetch(`${base}/vsx/..%2fpackage.json`);
  assert.equal(escape.status, 404);
});
