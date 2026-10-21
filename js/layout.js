/**
 * Redimensionamento dos painéis.
 *
 * Três divisórias, como no VS Code:
 *
 *   - a **largura da barra lateral** (repositórios em cima, arquivos embaixo);
 *   - a **altura da lista de repositórios** dentro da barra lateral;
 *   - a **altura do terminal** — o editor fica com o resto do espaço.
 *
 * Os tamanhos ficam no `localStorage` (`vsx.layout`), então a página volta do
 * jeito que o usuário deixou. Cada divisória também responde às setas do
 * teclado quando está focada, e o duplo clique devolve o tamanho padrão.
 */

const STORE_KEY = "vsx.layout";

/** Tamanhos em pixels. `0` = ainda não foi arrastado (usa o padrão do CSS). */
const DEFAULTS = {
  sidebarWidth: 300,
  reposHeight: 0,
  terminalHeight: 0,
};

/** Limites: o que for menor que isso não dá para usar. */
const LIMITS = {
  sidebarWidth: 200,
  reposHeight: 90,
  terminalHeight: 120,
};

/** Altura inicial da lista de repositórios, como fração da barra lateral. */
const REPOS_RATIO = 0.38;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* navegador em modo privado: os tamanhos valem só para esta sessão */
  }
}

/**
 * Liga uma divisória.
 *
 * `onMove` recebe o evento do ponteiro durante o arrasto, `onStep` recebe o
 * quanto mudou quando o teclado move a divisória, e `onDone` é chamada no fim
 * de cada interação — com `restore` verdadeiro quando foi um duplo clique
 * (aí o tamanho volta ao padrão).
 */
function bind(handle, { cursor, onMove, onStep, onDone }) {
  if (!handle) return;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";

    const move = (ev) => onMove(ev);
    const stop = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      onDone(false);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });

  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onStep(-step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onStep(step);
    } else {
      return;
    }
    onDone(false);
  });

  handle.addEventListener("dblclick", () => onDone(true));
}

/** Aplica os tamanhos guardados e liga as divisórias. */
export function setupLayout() {
  const layout = document.querySelector(".layout");
  const sidebar = document.getElementById("sidebar");
  const repos = document.getElementById("panel-repos");
  const terminal = document.getElementById("terminal");
  const main = document.querySelector(".panel-main");

  if (!layout || !sidebar || !repos || !terminal || !main) return;

  const state = read();

  /* --------------------------------------------------------- larguras/alturas */

  const applySidebar = (width) => {
    // o editor precisa de pelo menos um terço da tela
    const max = Math.max(window.innerWidth - 320, LIMITS.sidebarWidth);
    state.sidebarWidth = clamp(Math.round(width), LIMITS.sidebarWidth, max);
    layout.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  };

  const applyRepos = (height) => {
    const max = Math.max(sidebar.clientHeight - 160, LIMITS.reposHeight);
    state.reposHeight = clamp(Math.round(height), LIMITS.reposHeight, max);
    layout.style.setProperty("--repos-height", `${state.reposHeight}px`);
  };

  const applyTerminal = (height) => {
    const max = Math.max(main.clientHeight - 160, LIMITS.terminalHeight);
    state.terminalHeight = clamp(Math.round(height), LIMITS.terminalHeight, max);
    terminal.style.flex = `0 0 ${state.terminalHeight}px`;
  };

  const resetRepos = () => {
    // volta para a fração inicial da barra lateral
    applyRepos(sidebar.clientHeight * REPOS_RATIO);
  };

  const resetTerminal = () => {
    state.terminalHeight = DEFAULTS.terminalHeight;
    terminal.style.flex = "";
  };

  // a altura que está na tela agora (base do teclado quando nunca se arrastou)
  const reposNow = () => repos.getBoundingClientRect().height;
  const terminalNow = () => terminal.getBoundingClientRect().height;

  /* ------------------------------------------------------------- divisórias */

  bind(document.getElementById("splitter-sidebar"), {
    cursor: "col-resize",
    onMove: (event) => applySidebar(event.clientX - sidebar.getBoundingClientRect().left),
    onStep: (delta) => applySidebar(state.sidebarWidth + delta),
    onDone: (restore) => {
      if (restore) applySidebar(DEFAULTS.sidebarWidth);
      write(state);
    },
  });

  bind(document.getElementById("splitter-repos"), {
    cursor: "row-resize",
    onMove: (event) => applyRepos(event.clientY - repos.getBoundingClientRect().top),
    onStep: (delta) => applyRepos((state.reposHeight || reposNow()) + delta),
    onDone: (restore) => {
      if (restore) resetRepos();
      write(state);
    },
  });

  bind(document.getElementById("splitter-terminal"), {
    cursor: "row-resize",
    onMove: (event) => {
      const rect = main.getBoundingClientRect();
      applyTerminal(rect.bottom - event.clientY);
    },
    onStep: (delta) => applyTerminal((state.terminalHeight || terminalNow()) + delta),
    onDone: (restore) => {
      if (restore) resetTerminal();
      write(state);
    },
  });

  /* ------------------------------------------------------------- aplicação */

  applySidebar(state.sidebarWidth);
  if (state.reposHeight > 0) {
    applyRepos(state.reposHeight);
  } else {
    // primeira vez: a lista de repositórios fica com um terço da barra lateral
    applyRepos(sidebar.clientHeight * REPOS_RATIO);
  }
  if (state.terminalHeight > 0) applyTerminal(state.terminalHeight);

  // a janela encolheu: a barra lateral não pode ficar maior que a tela
  window.addEventListener("resize", () => {
    applySidebar(state.sidebarWidth);
    if (state.reposHeight > 0) applyRepos(state.reposHeight);
    if (state.terminalHeight > 0) applyTerminal(state.terminalHeight);
  });
}
