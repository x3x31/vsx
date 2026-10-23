/**
 * O provedor "Codespaces" no frontend (§14.8, item 3).
 *
 * A página roda na origem do GitHub Pages (aqui, um servidor estático) e o
 * workspace é uma ponte isolada, com URL/token próprios. O teste cobre o
 * assistente de conexão, o token recusado, a persistência no localStorage,
 * a reconexão automática ao recarregar e o workspace parado/expirado.
 *
 *   npm run test:e2e
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startBridge, startMockGithub, startStaticServer } from "./helpers.mjs";

const SECRET = "senha-do-workspace";
const TOKEN = "gho_codespace";

test("GitHub Pages: conectar, lembrar e reconectar o workspace do Codespaces", async () => {
  const github = await startMockGithub({ token: TOKEN });
  const site = await startStaticServer();
  const bridge = await startBridge({
    github,
    secret: SECRET,
    env: {
      HOST: "0.0.0.0",
      CODESPACES: "true",
      CODESPACE_NAME: "aluno-vsx",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
      BRIDGE_SECRET: SECRET,
      CORS_ORIGINS: site.url,
      GITHUB_TOKEN: TOKEN,
    },
  });

  // a ponte do Codespace já tem a conta conectada (é o workspace de um aluno)
  const connected = await fetch(`${bridge.url}/api/github/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-vsx-secret": SECRET },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.equal(connected.status, 200);
  assert.equal((await connected.json()).user.login, "alice");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(site.url);

    // sem token no navegador, a janela de conexão abre com o atalho do Codespaces
    await page.waitForSelector("#modal-connect:not([hidden])");
    await page.click("#btn-open-codespace");
    await page.waitForSelector("#modal-codespace:not([hidden])");

    // token errado: o workspace responde 401 e o vsx explica
    await page.fill("#codespace-url", bridge.url);
    await page.fill("#codespace-secret", "senha-errada");
    await page.click("#btn-codespace-save");
    await page.waitForSelector("#codespace-error:not([hidden])");
    assert.match(await page.textContent("#codespace-error"), /recusou a senha/i);
    assert.equal(await page.locator("#modal-codespace").isVisible(), true);

    // token certo: conecta, adota a conta da ponte e carrega os repositórios
    await page.fill("#codespace-secret", SECRET);
    await page.click("#btn-codespace-save");
    await page.waitForSelector("#modal-codespace[hidden]");
    await page.waitForFunction(
      () => document.getElementById("btn-codespace")?.textContent.includes("on-line"),
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => document.getElementById("user-label")?.textContent === "alice",
      null,
      { timeout: 15000 },
    );

    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem("vsx.codespace")));
    assert.equal(saved.url, bridge.url);
    assert.equal(saved.token, SECRET);
    assert.equal(saved.publicUrl, `https://aluno-vsx-${bridge.port}.app.github.dev`);

    // recarregar não pede a URL/senha de novo: o workspace salvo é reencontrado
    await page.reload();
    await page.waitForFunction(
      () => document.getElementById("btn-codespace")?.textContent.includes("on-line"),
      null,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => document.getElementById("user-label")?.textContent === "alice",
      null,
      { timeout: 15000 },
    );
    assert.equal(await page.evaluate(() => document.getElementById("modal-connect").hidden), true);

    // workspace parado/expirado: o estado aparece no topo e a janela de
    // reconexão abre com a URL e a senha já preenchidas
    await page.evaluate(() => {
      const config = JSON.parse(localStorage.getItem("vsx.codespace"));
      config.url = "http://127.0.0.1:1";
      localStorage.setItem("vsx.codespace", JSON.stringify(config));
    });
    await page.reload();
    await page.waitForSelector("#modal-codespace:not([hidden])", { timeout: 20000 });
    assert.match(await page.textContent("#btn-codespace"), /parado/i);
    assert.equal(await page.inputValue("#codespace-url"), "http://127.0.0.1:1");
    assert.equal(await page.inputValue("#codespace-secret"), SECRET);
    assert.equal(await page.locator("#btn-codespace-disconnect").isVisible(), true);
  } finally {
    await browser.close();
    await bridge.stop();
    await site.close();
    await github.close();
  }
});
