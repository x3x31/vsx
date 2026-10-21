/**
 * Layout: divisórias e painéis expansíveis.
 *
 * Três divisórias, como no VS Code:
 *
 *   - a **largura da barra lateral** (repositórios em cima, arquivos embaixo);
 *   - a **altura da lista de repositórios** dentro da barra lateral;
 *   - a **altura do terminal** — o editor fica com o resto do espaço.
 *
 * E três painéis que podem ser recolhidos: a **barra lateral**, o **editor** e
 * o **terminal**. Recolhidos, eles encolhem até o cabeçalho (ou somem, no
 * caso da barra lateral) e abrem de novo pelo mesmo botão.
 *
 * Os tamanhos e o estado dos painéis ficam no `localStorage` (`vsx.layout`),
 * então a página volta do jeito que o usuário deixou. Cada divisória também
 * responde às setas do teclado quando está focada, e o duplo clique devolve o
 * tamanho padrão.
 */

const STORE_KEY = "vsx.layout";

/** Tamanhos em pixels. `0` = ainda não foi arrastado (usa o padrão do CSS). */
const DEFAULTS = {
  sidebarWidth: 300,
  reposHeight: 0,
  terminalHeight: 0,
  collapsed: { sidebar: false, editor: false, terminal: false },
};

/** Limites: o que for menor que isso não dá para usar. */
const LIMITS = {
  sidebarWidth: 200,
  reposHeight: 90,
  terminalHeight: 120,
};

/** Altura inicial da lista de repositórios, como fração da barra lateral. */
const REPOS_RATIO = 0.38;

/** No celular o layout vira uma coluna: os tamanhos em pixels não valem. */
const empilhado = () => window.matchMedia("(max-width: 860px)").matches;

/** Rótulos dos botões de recolher (o ícone é um chevron que gira). */
const PANELS = {
  sidebar: { title: "a barra lateral", glyph: null },
  editor: { title: "o editor", glyph: "▾" },
  terminal: { title: "o terminal", glyph: "▾" },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return {
      ...DEFAULTS,
      ...saved,
      collapsed: { ...DEFAULTS.collapsed, ...(saved.collapsed || {}) },
    };
  } catch {
    return { ...DEFAULTS, collapsed: { ...DEFAULTS.collapsed } };
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

/**
 * Aplica os tamanhos guardados, liga as divisórias e devolve o controle dos
 * painéis expansíveis.
 *
 * `onResize` é chamado sempre que o espaço do editor muda (janela redimensionada
 * ou painel recolhido) — é o que o CodeMirror precisa para se reajustar.
 */
export function setupLayout({ onResize } = {}) {
  const layout = document.querySelector(".layout");
  const sidebar = document.getElementById("sidebar");
  const repos = document.getElementById("panel-repos");
  const terminal = document.getElementById("terminal");
  const main = document.querySelector(".panel-main");
  const editorArea = document.getElementById("editor-area");

  if (!layout || !sidebar || !repos || !terminal || !main || !editorArea) return null;

  const state = read();

  /** Os nós e os botões de cada painel expansível. */
  const nodes = {
    sidebar,
    editor: editorArea,
    terminal,
  };

  const buttons = {
    sidebar: document.getElementById("btn-toggle-sidebar"),
    editor: document.getElementById("btn-toggle-editor"),
    terminal: document.getElementById("btn-toggle-terminal"),
  };

  /* --------------------------------------------------------- larguras/alturas */

  const applySidebar = (width) => {
    if (empilhado()) return;
    // o editor precisa de pelo menos um terço da tela
    const max = Math.max(window.innerWidth - 320, LIMITS.sidebarWidth);
    state.sidebarWidth = clamp(Math.round(width), LIMITS.sidebarWidth, max);
    layout.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  };

  const applyRepos = (height) => {
    if (empilhado()) return;
    const max = Math.max(sidebar.clientHeight - 160, LIMITS.reposHeight);
    state.reposHeight = clamp(Math.round(height), LIMITS.reposHeight, max);
    layout.style.setProperty("--repos-height", `${state.reposHeight}px`);
  };

  /** O tamanho do terminal só vale enquanto ele está aberto. */
  const applyTerminalSize = () => {
    if (empilhado() || state.collapsed.terminal || state.terminalHeight <= 0) {
      terminal.style.flex = "";
      return;
    }
    terminal.style.flex = `0 0 ${state.terminalHeight}px`;
  };

  const applyTerminal = (height) => {
    if (empilhado()) return;
    const max = Math.max(main.clientHeight - 160, LIMITS.terminalHeight);
    state.terminalHeight = clamp(Math.round(height), LIMITS.terminalHeight, max);
    applyTerminalSize();
  };

  const resetRepos = () => {
    // volta para a fração inicial da barra lateral
    applyRepos(sidebar.clientHeight * REPOS_RATIO);
  };

  const resetTerminal = () => {
    state.terminalHeight = DEFAULTS.terminalHeight;
    applyTerminalSize();
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

  /* ------------------------------------------------------- painéis expansíveis */

  const notifyResize = () => {
    requestAnimationFrame(() => onResize?.());
  };

  const applyCollapsed = (name, collapsed) => {
    state.collapsed[name] = collapsed;
    nodes[name]?.classList.toggle("collapsed", collapsed);

    if (name === "terminal") {
      main.classList.toggle("terminal-collapsed", collapsed);
      applyTerminalSize();
    }

    const button = buttons[name];
    if (button) {
      const panel = PANELS[name];
      button.setAttribute("aria-pressed", collapsed ? "true" : "false");
      button.classList.toggle("active", collapsed);
      if (panel.glyph) button.textContent = collapsed ? "▴" : panel.glyph;
      button.title = `${collapsed ? "Mostrar" : "Recolher"} ${panel.title}`;
    }
  };

  const toggle = (name) => {
    if (!nodes[name]) return;
    applyCollapsed(name, !state.collapsed[name]);
    write(state);
    notifyResize();
  };

  for (const name of Object.keys(PANELS)) {
    buttons[name]?.addEventListener("click", () => toggle(name));
    applyCollapsed(name, Boolean(state.collapsed[name]));
  }

  /* ------------------------------------------------------------- aplicação */

  applySidebar(state.sidebarWidth);
  if (state.reposHeight > 0) {
    applyRepos(state.reposHeight);
  } else {
    // primeira vez: a lista de repositórios fica com um terço da barra lateral
    applyRepos(sidebar.clientHeight * REPOS_RATIO);
  }
  applyTerminalSize();

  // a janela encolheu: a barra lateral não pode ficar maior que a tela
  window.addEventListener("resize", () => {
    applySidebar(state.sidebarWidth);
    if (!state.collapsed.sidebar && state.reposHeight > 0) applyRepos(state.reposHeight);
    applyTerminalSize();
    notifyResize();
  });

  notifyResize();

  return {
    toggle,
    isCollapsed: (name) => Boolean(state.collapsed[name]),
  };
}
