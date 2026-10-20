/**
 * Fluxo completo do GitHub Pages: um clique em "Conectar com GitHub", a
 * janela do GitHub, "Authorize" — e o vsx fica conectado.
 *
 * O GitHub é simulado (o authorize devolve o código na query da própria
 * página, como o GitHub real faria), o broker é o worker de broker/worker.js
 * e o site é o index.html do repositório servido em outra origem — que é
 * exatamente a topologia do GitHub Pages.
 *
 *   npm run test:e2e
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startBroker, startMockGithub, startStaticServer } from "./helpers.mjs";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
};

/** Responde a uma rota do GitHub com CORS (as chamadas vêm do navegador). */
async function fulfillJson(route, status, body) {
  const preflight = route.request().method() === "OPTIONS";
  await route.fulfill({
    status: preflight ? 204 : status,
    headers: preflight
      ? {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "accept, authorization, content-type, x-github-api-version",
          "access-control-max-age": "600",
        }
      : jsonHeaders,
    body: preflight ? "" : JSON.stringify(body),
  });
}

test("GitHub Pages: um clique em Conectar com GitHub conecta a conta", async () => {
  const github = await startMockGithub();
  const site = await startStaticServer();
  const broker = await startBroker({ github, allowedOrigins: site.url });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript((url) => {
      try {
        localStorage.setItem("vsx.broker", url);
      } catch {
        /* about:blank */
      }
    }, broker.url);

    // GitHub simulado: a autorizacao volta para a pagina do vsx com o codigo
    let authorizeQuery = null;
    await context.route(/^https:\/\/github\.com\/login\/oauth\/authorize/, async (route) => {
      const url = new URL(route.request().url());
      authorizeQuery = Object.fromEntries(url.searchParams);
      const callback = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      await route.fulfill({
        status: 302,
        headers: { location: `${callback}?code=TESTCODE&state=${encodeURIComponent(state)}` },
      });
    });

    // API do GitHub direto no navegador (modo direto)
    await context.route(/^https:\/\/api\.github\.com\//, (route) => {
      const url = route.request().url();
      if (url.includes("/user/repos")) return fulfillJson(route, 200, []);
      return fulfillJson(route, 200, { login: "alice", name: "Alice", avatar_url: "https://example.com/a.png" });
    });

    const page = await context.newPage();
    await page.goto(site.url);

    // sem token salvo, a janela de conexao abre sozinha
    await page.waitForSelector("#modal-connect:not([hidden])");

    const popupPromise = context.waitForEvent("page");
    await page.click("#btn-oauth");
    const popup = await popupPromise;

    try {
      await popup.waitForEvent("close", { timeout: 45000 });
    } catch (err) {
      const dump = async (locator) => locator.textContent().catch(() => null);
      throw new Error(
        `a janela de autorizacao nao fechou: ${err.message}\n` +
          `  erro no popup: ${await dump(popup.locator("#connect-error"))}\n` +
          `  status: ${await dump(popup.locator("#oauth-status"))}\n` +
          `  erro na pagina: ${await dump(page.locator("#connect-error"))}`,
      );
    }

    await page.waitForFunction(() => document.getElementById("user-label")?.textContent === "alice", null, {
      timeout: 20000,
    });

    // conectado: token no navegador (nao em servidor nenhum) e janela fechada
    assert.equal(await page.evaluate(() => localStorage.getItem("vsx.token")), "gho_broker_token");
    assert.equal(await page.evaluate(() => document.getElementById("modal-connect").hidden), true);

    // o que foi pedido ao GitHub
    assert.equal(authorizeQuery.client_id, "Iv1.teste", "Client ID veio do broker");
    assert.equal(authorizeQuery.redirect_uri, `${site.url}/`, "retorno e a propria pagina do vsx");
    assert.equal(authorizeQuery.scope, "repo");
    assert.equal(authorizeQuery.code_challenge_method, "S256");
    assert.match(authorizeQuery.code_challenge, /^[A-Za-z0-9_-]+$/);
    assert.ok(authorizeQuery.state, "PKCE e state enviados");

    // o que o broker trocou: o codigo do GitHub, com o verificador da mesma janela
    const sent = github.state.tokenRequests.at(-1);
    assert.equal(sent.code, "TESTCODE");
    assert.equal(sent.client_id, "Iv1.teste");
    assert.equal(sent.redirect_uri, `${site.url}/`);
    assert.ok(sent.code_verifier, "code_verifier repassado pelo navegador");
    assert.equal(github.state.tokenRequests.length, 1, "uma unica troca");

    // e o login veio do GitHub em modo direto
    assert.ok(github.state.userRequests > 0, "usuario buscado direto na API");
  } finally {
    await browser.close();
    await broker.close();
    await site.close();
    await github.close();
  }
});

test("sem broker nem ponte, o vsx explica o que falta antes de abrir o GitHub", async () => {
  const site = await startStaticServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    let popupAberta = false;
    let chegouAoGithub = false;
    context.on("page", (page) => {
      popupAberta = true;
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame() && frame.url().startsWith("https://github.com")) chegouAoGithub = true;
      });
    });

    await page.goto(site.url);
    await page.waitForSelector("#modal-connect:not([hidden])");
    await page.click("#btn-oauth");

    await page.waitForSelector("#connect-error:not([hidden])", { timeout: 45000 });
    const message = (await page.textContent("#connect-error")).trim();
    assert.match(message, /Nenhum ponto para trocar/);
    assert.match(message, /broker/);

    // a configuracao avancada abre sozinha, com o campo do broker em foco
    assert.equal(await page.evaluate(() => document.getElementById("oauth-advanced").open), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), "broker-url");

    // a janela em branco (aberta para nao perder o gesto do clique) foi
    // descartada: nenhuma autorizacao chegou a ser iniciada
    await page.waitForTimeout(700);
    assert.equal(chegouAoGithub, false);
    assert.ok(popupAberta, "a janela em branco nasceu dentro do gesto");
  } finally {
    await browser.close();
    await site.close();
  }
});
