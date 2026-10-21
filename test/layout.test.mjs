/**
 * Layout responsivo: no celular a página vira uma coluna (barra lateral →
 * editor → terminal), a barra superior fica grudada no topo e qualquer painel
 * pode ser recolhido. No desktop a barra lateral continua ao lado do editor.
 *
 *   npm run test:e2e
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startStaticServer } from "./helpers.mjs";

/** Esconde a janela de conexão (abre sozinha, sem token) para não pegar os cliques. */
const semModal = (page) =>
  page.evaluate(() => {
    const modal = document.getElementById("modal-connect");
    if (modal) modal.style.display = "none";
  });

const caixa = (page, seletor) =>
  page.evaluate((sel) => {
    const node = document.querySelector(sel);
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  }, seletor);

test("celular: editor e terminal descem para baixo da barra lateral", async () => {
  const site = await startStaticServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(site.url);
    await page.waitForTimeout(600);
    await semModal(page);

    // tudo empilhado, um painel abaixo do outro
    const repos = await caixa(page, "#panel-repos");
    const arquivos = await caixa(page, "#panel-files");
    const editor = await caixa(page, "#editor-area");
    const terminal = await caixa(page, "#terminal");
    assert.ok(arquivos.bottom <= editor.top + 2, "o editor fica abaixo da barra lateral");
    assert.ok(editor.bottom <= terminal.top + 2, "o terminal fica abaixo do editor");
    assert.ok(repos.bottom <= arquivos.top + 2, "os arquivos ficam abaixo dos repositórios");

    // a página rola (nada fica fixo na tela)
    const altura = await page.evaluate(() => ({
      pagina: document.body.scrollHeight,
      tela: document.documentElement.clientHeight,
    }));
    assert.ok(altura.pagina > altura.tela + 100, "a página precisa rolar");

    // a barra superior continua no topo depois da rolagem
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(200);
    const topo = await caixa(page, ".titlebar");
    assert.ok(Math.abs(topo.top) < 2, "a barra superior fica grudada no topo");

    // as divisórias não aparecem no celular
    for (const id of ["splitter-sidebar", "splitter-repos", "splitter-terminal"]) {
      assert.equal(await page.locator(`#${id}`).isVisible(), false, `#${id} não deve aparecer`);
    }

    // os painéis rolam com a página
    const posicoes = await page.evaluate(() =>
      ["sidebar", "editor-area", "terminal"].map((id) => ({
        id,
        position: getComputedStyle(document.getElementById(id)).position,
      })),
    );
    for (const item of posicoes) {
      assert.notEqual(item.position, "fixed", `${item.id} não pode ficar fixo na tela`);
      assert.notEqual(item.position, "sticky", `${item.id} não pode grudar na tela`);
    }
  } finally {
    await browser.close();
    await site.close();
  }
});

test("painéis expansíveis: recolher, abrir e guardar o estado", async () => {
  const site = await startStaticServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(site.url);
    await page.waitForTimeout(600);
    await semModal(page);

    // no desktop a barra lateral fica ao lado do editor
    const lateral = await caixa(page, "#sidebar");
    const painel = await caixa(page, ".panel-main");
    assert.ok(painel.left >= lateral.right - 1, "a barra lateral fica à esquerda");

    // recolher a barra lateral devolve o espaço ao editor
    const antes = painel.width;
    await page.click("#btn-toggle-sidebar");
    await page.waitForTimeout(200);
    assert.equal((await caixa(page, "#sidebar")).height, 0, "a barra lateral some");
    const depois = (await caixa(page, ".panel-main")).width;
    assert.ok(depois > antes + 200, "o editor cresce");
    assert.equal(
      await page.getAttribute("#btn-toggle-sidebar", "aria-pressed"),
      "true",
      "o botão avisa que o painel está recolhido",
    );
    await page.click("#btn-toggle-sidebar");
    await page.waitForTimeout(200);

    // recolher o terminal deixa só o cabeçalho
    await page.click("#btn-toggle-terminal");
    await page.waitForTimeout(200);
    assert.ok((await caixa(page, "#terminal")).height < 60, "o terminal encolhe até o cabeçalho");
    assert.equal(
      (await caixa(page, "#terminal-log")).height,
      0,
      "o log do terminal some",
    );
    assert.equal(
      await page.locator("#splitter-terminal").isVisible(),
      false,
      "a divisória do terminal some com ele",
    );
    await page.click("#btn-toggle-terminal");
    await page.waitForTimeout(200);

    // recolher o editor deixa só a barra de abas
    await page.click("#btn-toggle-editor");
    await page.waitForTimeout(200);
    assert.equal((await caixa(page, "#editor-host")).height, 0, "o editor some");
    assert.ok((await caixa(page, "#editor-area")).height < 80, "sobra a barra de abas");
    await page.click("#btn-toggle-editor");
    await page.waitForTimeout(200);

    // o estado fica guardado e volta no recarregamento
    await page.click("#btn-toggle-sidebar");
    await page.waitForTimeout(200);
    const guardado = await page.evaluate(() => localStorage.getItem("vsx.layout"));
    assert.match(guardado, /"collapsed"/, "o estado dos painéis é guardado");
    await page.reload();
    await page.waitForTimeout(600);
    await semModal(page);
    assert.equal((await caixa(page, "#sidebar")).height, 0, "a barra lateral continua recolhida");
  } finally {
    await browser.close();
    await site.close();
  }
});
