import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GitHub, GitHubError } from "./github.js";
import { loadConfig, saveConfig, WORKSPACE_DIR } from "./config.js";
import { OAuth } from "./oauth.js";
import { OpenCode } from "./opencode.js";
import * as ws from "./workspace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";

/** Arquivos e pastas do front-end servidos pela ponte. */
const STATIC_ALLOWLIST = new Set(["index.html", "css", "js", "vendor", "favicon.ico"]);

/**
 * Quando a ponte escuta fora do loopback (ex.: Codespace com porta publica),
 * qualquer processo da rede poderia falar com ela. Nesse caso a senha e exigida.
 */
const config = loadConfig();
const github = new GitHub(config);
const opencode = new OpenCode();
const oauth = new OAuth({ clientId: config.clientId || process.env.GITHUB_OAUTH_CLIENT_ID || null });

const LOOPBACK = ["127.0.0.1", "localhost", "::1"];
const needsSecret = !LOOPBACK.includes(HOST);
const BRIDGE_SECRET =
  process.env.BRIDGE_SECRET ||
  config.bridgeSecret ||
  saveConfig({ bridgeSecret: randomBytes(24).toString("hex") }).bridgeSecret;

/**
 * Origens autorizadas a falar com a ponte. O GitHub Pages entra por padrão
 * (https://<dono>.github.io) e o proprio servidor em localhost.
 */
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ||
  [
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://x3x31.github.io",
  ].join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const state = {
  repo: null, // { fullName, branch, path }
  watcher: null,
  watchRoot: null,
};

const clients = new Set();

/* ------------------------------------------------------------------ utils */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Corpo da requisicao invalido");
  }
}

function broadcast(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

function errorStatus(err) {
  if (err instanceof GitHubError) return err.status || 502;
  if (err instanceof ws.WorkspaceError) return err.status || 400;
  if (err instanceof Error && err.status) return err.status;
  return 500;
}

/* ----------------------------------------------------------------- static */

async function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === "/" || relative === "") relative = "/index.html";

  const top = relative.split("/").filter(Boolean)[0] || "index.html";
  if (!STATIC_ALLOWLIST.has(top)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Nao encontrado");
    return;
  }

  const target = path.join(ROOT_DIR, path.normalize(relative).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(ROOT_DIR)) {
    res.writeHead(403).end("Proibido");
    return;
  }
  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) throw new Error("dir");
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": stat.size,
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    fs.createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Nao encontrado");
  }
}

/* ------------------------------------------------------------------ watch */

function watchWorkspace(root) {
  if (state.watchRoot === root && state.watcher) return;
  stopWatching();
  try {
    state.watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      if (rel.includes(`${path.sep}.git${path.sep}`) || rel.startsWith(".git")) return;
      broadcast("fs.changed", { repo: state.repo?.fullName, path: rel });
      scheduleStatus(root);
    });
    state.watchRoot = root;
  } catch {
    state.watcher = null;
    state.watchRoot = null;
  }
}

function stopWatching() {
  if (state.watcher) {
    try {
      state.watcher.close();
    } catch {
      /* ignore */
    }
  }
  state.watcher = null;
  state.watchRoot = null;
}

let statusTimer = null;
function scheduleStatus(root) {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(async () => {
    statusTimer = null;
    try {
      const entries = await ws.gitStatus(root);
      const branch = await ws.currentBranch(root);
      broadcast("git.status", { entries, branch, repo: state.repo?.fullName });
    } catch {
      /* ignore */
    }
  }, 250);
}

/* ------------------------------------------------------------------- SSE */

async function handleStream(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write("retry: 2000\n\n");
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  clients.add(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* ignore */
    }
  }, 20000);

  const cleanup = () => {
    clearInterval(keepAlive);
    clients.delete(res);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
}

/** Encaminha os eventos do OpenCode para todos os clientes conectados. */
async function pumpOpenCodeEvents() {
  try {
    const res = await opencode.events();
    if (!res.ok || !res.body) throw new Error(`stream indisponivel (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const match = chunk.match(/^data:\s*(\{[\s\S]*\})\s*$/m);
        if (!match) continue;
        try {
          const event = JSON.parse(match[1]);
          broadcast("opencode", event);
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    broadcast("opencode.error", { message: err.message });
    // nao insiste se o binario nao existir no PATH
    if (!opencode.unavailableReason) {
      setTimeout(pumpOpenCodeEvents, 4000);
    }
  }
}

/* ------------------------------------------------------------------ routes */

const routes = {
  "GET /api/bridge/info": async () => ({
    name: "vsx-bridge",
    version: "1.0.0",
    pid: process.pid,
    host: HOST,
    requiresSecret: needsSecret,
    connected: github.connected,
    user: config.user?.login || null,
    opencode: { running: opencode.running, url: opencode.url },
    workspaceDir: WORKSPACE_DIR,
    allowedOrigins: ALLOWED_ORIGINS,
  }),

  "GET /api/oauth/config": async () => ({
    configured: oauth.configured,
    clientId: oauth.clientId,
  }),

  /**
   * Volta do GitHub para o vsx depois da autorizacao.
   * O navegador chega aqui por navegacao (que nao e bloqueada por CORS
   * nem pela politica de loopback) e a ponte devolve o token redirecionando
   * para a pagina do vsx.
   */
  /**
   * Troca o codigo da autorizacao por um token.
   *
   * Usado quando a autorizacao volta para a propria pagina do vsx (modo
   * remoto): o navegador entrega o codigo e a ponte faz a troca, porque o
   * GitHub nao libera CORS para o navegador fazer isso sozinho.
   */
  "POST /oauth/exchange": async (req) => {
    const { code, state, clientId, redirectUri, verifier } = await readBody(req);
    if (!code) throw new GitHubError("Codigo de autorizacao ausente", 400);

    const result = await oauth.exchangeCode({
      code,
      state,
      clientId: clientId || oauth.clientId,
      clientSecret: config.clientSecret || process.env.GITHUB_OAUTH_CLIENT_SECRET || null,
      redirectUri,
      verifier,
    });

    github.setToken(result.token);
    let user = null;
    try {
      user = await github.getUser();
    } catch {
      /* segue sem os dados do usuario */
    }
    saveConfig({ token: result.token, user });
    config.user = user;

    // o token NAO volta para o navegador: quem guarda e a ponte
    return { ok: true, user, scope: result.scope };
  },

  "GET /oauth/callback": async (req, res, url) => {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";
    const error = url.searchParams.get("error");

    let payload = {};
    try {
      payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    } catch {
      payload = {};
    }

    const returnTo = payload.r || "/";
    const fail = (message) => {
      res.writeHead(302, { location: `${returnTo}#vsx_error=${encodeURIComponent(message)}` });
      res.end();
    };

    if (error) {
      fail(error);
      return;
    }
    if (!code) {
      fail("O GitHub não devolveu o código de autorização.");
      return;
    }

    try {
      const result = await oauth.exchangeCode({
        code,
        state,
        clientId: payload.c || oauth.clientId,
        clientSecret: config.clientSecret || process.env.GITHUB_OAUTH_CLIENT_SECRET || null,
        redirectUri: payload.u,
        verifier: payload.v,
      });

      github.setToken(result.token);
      let user = null;
      try {
        user = await github.getUser();
      } catch {
        /* segue sem os dados do usuario */
      }
      saveConfig({ token: result.token, user });
      config.user = user;

      // o token NAO volta na URL: ele fica no servidor, como no VS Code.
      // a pagina so recebe a confirmacao e pergunta o estado a ponte.
      res.writeHead(302, {
        location: `${returnTo}#vsx_connected=1&vsx_login=${encodeURIComponent(user?.login || "")}`,
      });
      res.end();
      return;
    } catch (err) {
      fail(err.message);
      return;
    }
  },

  "POST /api/oauth/client": async (req) => {
    const { clientId } = await readBody(req);
    const value = (clientId || "").trim();
    if (!value) throw new GitHubError("Informe o Client ID do OAuth App", 400);
    oauth.clientId = value;
    saveConfig({ clientId: value });
    config.clientId = value;
    return { ok: true, clientId: value };
  },

  "POST /api/oauth/device/start": async (req) => {
    const { clientId } = await readBody(req);
    const started = await oauth.start({ clientId });
    if (clientId && clientId !== oauth.clientId) {
      oauth.clientId = clientId;
      saveConfig({ clientId });
      config.clientId = clientId;
    }
    return started;
  },

  "POST /api/oauth/device/poll": async (req) => {
    const { deviceCode } = await readBody(req);
    const result = await oauth.poll(deviceCode);
    if (!result.token) return result;

    // valida o token e devolve o usuario junto
    github.setToken(result.token);
    let user = null;
    try {
      user = await github.getUser();
    } catch {
      github.clearToken();
      throw new GitHubError("O token devolvido pelo GitHub não foi aceito", 401);
    }
    saveConfig({ token: result.token, user });
    config.user = user;
    return { pending: false, token: result.token, scope: result.scope, user };
  },

  "GET /api/state": async () => ({
    connected: github.connected,
    user: config.user,
    repo: state.repo,
    opencode: { running: opencode.running, url: opencode.url },
    workspaceDir: WORKSPACE_DIR,
  }),

  "POST /api/github/connect": async (req) => {
    const { token } = await readBody(req);
    const candidate = (token || "").trim() || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!candidate) throw new GitHubError("Informe um token de acesso pessoal", 400);
    github.setToken(candidate);
    try {
      const user = await github.getUser();
      const repos = await github.listRepos();
      saveConfig({ token: candidate, user, disabled: false });
      config.user = user;
      config.disabled = false;
      return { user, repos };
    } catch (err) {
      github.clearToken();
      throw err;
    }
  },

  "POST /api/github/disconnect": async () => {
    github.clearToken();
    saveConfig({ token: null, user: null, disabled: true });
    config.user = null;
    config.disabled = true;
    return { connected: false };
  },

  "GET /api/github/user": async () => github.getUser(),

  "GET /api/github/repos": async () => {
    const repos = await github.listRepos();
    return { repos };
  },

  "GET /api/github/branches": async (req, res, url) => {
    const repo = url.searchParams.get("repo") || state.repo?.fullName;
    if (!repo) throw new GitHubError("Repositorio nao selecionado", 400);
    return { branches: await github.listBranches(repo) };
  },

  "GET /api/github/commits": async (req, res, url) => {
    const repo = url.searchParams.get("repo") || state.repo?.fullName;
    const branch = url.searchParams.get("branch") || state.repo?.branch;
    if (!repo) throw new GitHubError("Repositorio nao selecionado", 400);
    return { commits: await github.listCommits(repo, branch) };
  },

  "GET /api/github/contents": async (req, res, url) => {
    const repo = url.searchParams.get("repo") || state.repo?.fullName;
    const file = url.searchParams.get("path") || "";
    if (!repo) throw new GitHubError("Repositorio nao selecionado", 400);
    return { content: await github.getContents(repo, file, state.repo?.branch) };
  },

  "POST /api/workspace/open": async (req) => {
    const { repo, branch } = await readBody(req);
    if (!repo) throw new ws.WorkspaceError("Informe o repositorio");

    const info = await github.getRepo(repo);
    const result = await ws.openWorkspace({
      fullName: repo,
      branch: branch || info.defaultBranch,
      token: github.token,
    });

    state.repo = {
      fullName: repo,
      branch: await ws.currentBranch(result.path),
      path: result.path,
      defaultBranch: info.defaultBranch,
      permissions: info.permissions,
    };
    watchWorkspace(result.path);

    const files = await ws.listFiles(result.path);
    const status = await ws.gitStatus(result.path);
    saveConfig({ lastRepo: repo, lastBranch: state.repo.branch });
    broadcast("workspace.opened", { repo: state.repo, files });
    return {
      repo: state.repo,
      files,
      status,
      cloned: result.cloned,
      updated: result.updated,
      pullMessage: result.pullMessage,
    };
  },

  "GET /api/workspace/files": async () => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    return { files: await ws.listFiles(state.repo.path) };
  },

  "GET /api/workspace/file": async (req, res, url) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const file = url.searchParams.get("path");
    if (!file) throw new ws.WorkspaceError("Informe o caminho do arquivo", 400);
    return ws.readFile(state.repo.path, file);
  },

  "PUT /api/workspace/file": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { path: file, content } = await readBody(req);
    if (!file) throw new ws.WorkspaceError("Informe o caminho do arquivo", 400);
    const result = await ws.writeFile(state.repo.path, file, content);
    scheduleStatus(state.repo.path);
    return result;
  },

  "POST /api/workspace/new": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { path: file, content = "" } = await readBody(req);
    if (!file) throw new ws.WorkspaceError("Informe o caminho do arquivo", 400);
    const result = await ws.createFile(state.repo.path, file, content);
    scheduleStatus(state.repo.path);
    return result;
  },

  "DELETE /api/workspace/file": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { path: file } = await readBody(req);
    if (!file) throw new ws.WorkspaceError("Informe o caminho do arquivo", 400);
    const result = await ws.removeFile(state.repo.path, file);
    scheduleStatus(state.repo.path);
    return result;
  },

  "GET /api/workspace/status": async () => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    return {
      entries: await ws.gitStatus(state.repo.path),
      branch: await ws.currentBranch(state.repo.path),
      branches: await ws.localBranches(state.repo.path),
    };
  },

  "GET /api/workspace/diff": async (req, res, url) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const file = url.searchParams.get("path");
    if (!file) throw new ws.WorkspaceError("Informe o caminho do arquivo", 400);
    return ws.diffFile(state.repo.path, file);
  },

  "POST /api/workspace/commit": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { message, branch } = await readBody(req);
    const result = await ws.commitAndPush(state.repo.path, {
      message,
      branch,
      token: github.token,
    });
    scheduleStatus(state.repo.path);
    return result;
  },

  "POST /api/workspace/discard": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { path: file } = await readBody(req);
    const result = await ws.discardChanges(state.repo.path, file);
    scheduleStatus(state.repo.path);
    return result;
  },

  "GET /api/opencode/status": async () => {
    if (!opencode.running) await opencode.start();
    return { running: opencode.running, url: opencode.url, info: await opencode.info() };
  },

  "GET /api/opencode/session": async () => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const session = await opencode.sessionFor(state.repo.path, { title: `vsx: ${state.repo.fullName}` });
    return { session, models: await opencode.models(state.repo.path), agents: await opencode.agents(state.repo.path) };
  },

  "POST /api/opencode/session/new": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { agent, model } = await readBody(req);
    const existing = await opencode.listSessions(state.repo.path);
    for (const session of existing) {
      if (!session.parentID) await opencode.deleteSession(session.id).catch(() => {});
    }
    opencode.forgetSession(state.repo.path);
    const session = await opencode.sessionFor(state.repo.path, {
      title: `vsx: ${state.repo.fullName}`,
      agent,
      model,
    });
    return { session };
  },

  "POST /api/opencode/prompt": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { text, files } = await readBody(req);
    if (!text || !text.trim()) throw new ws.WorkspaceError("Mensagem vazia", 400);
    const session = await opencode.sessionFor(state.repo.path, { title: `vsx: ${state.repo.fullName}` });
    const result = await opencode.prompt(session.id, { text, files });
    return { session, message: result };
  },

  "POST /api/opencode/interrupt": async () => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const session = await opencode.sessionFor(state.repo.path);
    return opencode.interrupt(session.id);
  },

  "GET /api/opencode/permission": async () => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const session = await opencode.sessionFor(state.repo.path);
    return { permissions: await opencode.permissions(session.id) };
  },

  "POST /api/opencode/permission": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { requestID, decision, message } = await readBody(req);
    if (!requestID || !decision) throw new ws.WorkspaceError("Informe requestID e decision", 400);
    const session = await opencode.sessionFor(state.repo.path);
    await opencode.replyPermission(session.id, requestID, decision, message);
    return { ok: true };
  },

  "POST /api/opencode/model": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { model } = await readBody(req);
    if (!model) throw new ws.WorkspaceError("Informe o modelo", 400);
    const session = await opencode.sessionFor(state.repo.path);
    await opencode.setModel(session.id, model);
    return { ok: true, model };
  },

  "POST /api/opencode/agent": async (req) => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const { agent } = await readBody(req);
    if (!agent) throw new ws.WorkspaceError("Informe o agente", 400);
    const session = await opencode.sessionFor(state.repo.path);
    await opencode.setAgent(session.id, agent);
    return { ok: true, agent };
  },

  "GET /api/opencode/messages": async () => {
    if (!state.repo) throw new ws.WorkspaceError("Nenhum repositorio aberto", 400);
    const session = await opencode.sessionFor(state.repo.path);
    return { messages: await opencode.messages(session.id) };
  },
};

/* ------------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const key = `${req.method} ${url.pathname}`;
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-headers", "content-type, x-vsx-token, x-vsx-secret");
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("access-control-max-age", "86400");
    // o Chrome exige esta permissão para uma origem publica alcancar uma rede privada
    if (req.headers["access-control-request-private-network"]) {
      res.setHeader("access-control-allow-private-network", "true");
    }
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // ponte exposta na rede: exige a senha (header ou query, para o EventSource)
  if (needsSecret && url.pathname.startsWith("/api/")) {
    const providedSecret = String(
      req.headers["x-vsx-secret"] || url.searchParams.get("secret") || "",
    );
    const provided = Buffer.from(providedSecret);
    const expected = Buffer.from(BRIDGE_SECRET);
    const valid =
      provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!valid) {
      sendJson(res, 401, {
        error: "A ponte exige a senha. Confira o valor impresso no terminal do servidor.",
      });
      return;
    }
  }

  // token informado pelo navegador (modo direto) tem prioridade sobre o do servidor
  const headerToken = req.headers["x-vsx-token"];
  if (typeof headerToken === "string" && headerToken) {
    github.setToken(headerToken);
  }

  if (url.pathname === "/api/stream") {
    await handleStream(req, res);
    return;
  }

  const handler = routes[key];
  if (!handler) {
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      await serveStatic(req, res, url.pathname);
      return;
    }
    sendJson(res, 404, { error: "Rota nao encontrada" });
    return;
  }

  try {
    const payload = await handler(req, res, url);
    // rotas que ja responderam (ex.: o redirect do OAuth) nao podem
    // receber um segundo corpo
    if (res.headersSent) return;
    sendJson(res, 200, payload ?? {});
  } catch (err) {
    const status = errorStatus(err);
    if (status >= 500) console.error(`[vsx] ${key}:`, err);
    if (res.headersSent) return;
    sendJson(res, status, { error: err.message || "Erro inesperado" });
  }
});

/** Abre o navegador, como o VS Code faz ao abrir um projeto. */
function openBrowser(url) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* sem navegador disponível: tudo bem */
  }
}

server.listen(PORT, HOST, () => {
  const url = `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`;
  console.log(`\n  vsx rodando em ${url}`);
  console.log(`  espelhos locais em ${WORKSPACE_DIR}`);
  if (config.user) console.log(`  GitHub: ${config.user.login} (${config.user.avatar})`);

  const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (forwardingDomain) {
    console.log(`\n  URL pública (Codespace): https://${PORT}-${forwardingDomain}`);
  }

  if (needsSecret) {
    console.log(`\n  ponte exposta em ${HOST} — senha obrigatória:`);
    console.log(`    ${BRIDGE_SECRET}`);
    console.log(`  informe essa senha na interface do vsx (botão “ponte”)`);
  }

  if (process.env.VSX_OPEN_BROWSER !== "0") {
    openBrowser(url);
  }

  console.log("");
  pumpOpenCodeEvents();
});

function shutdown() {
  stopWatching();
  opencode.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
