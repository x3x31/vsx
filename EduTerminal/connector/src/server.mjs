import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as defaultConfig } from "./config.mjs";
import { PairingManager } from "./pairing.mjs";
import { SessionManager } from "./sessions.mjs";
import { WsServer } from "./ws.mjs";
import { OpenCode } from "./opencode.mjs";
import * as ws from "./workspace.mjs";
import { Tools } from "./tools.mjs";
import * as gh from "./github.mjs";
import {
  HttpError,
  log,
  readJson,
  sendJson,
  sendText,
  setCors,
  safeEqual,
} from "./util.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const VSX_DIR = path.resolve(__dirname, "..", "..", "..");

const PUBLIC_ROUTES = new Set([
  "GET /health",
  "POST /api/eduterminal/pair/request",
  "GET /api/eduterminal/pair/status",
]);

const ADMIN_ROUTES = new Set([
  "POST /api/eduterminal/pairing/start",
  "GET /api/eduterminal/pairing/current",
  "POST /api/eduterminal/pairing/cancel",
  "GET /api/eduterminal/requests",
  "POST /api/eduterminal/pair/approve",
  "POST /api/eduterminal/pair/deny",
  "GET /api/eduterminal/tokens",
  "DELETE /api/eduterminal/tokens",
]);

function isLoopback(req) {
  const address = req.socket?.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function tokenFrom(req, url) {
  const authorization = req.headers.authorization || "";
  if (/^bearer\s+/i.test(authorization)) {
    return authorization.replace(/^bearer\s+/i, "").trim();
  }
  return (
    req.headers["x-eduterminal-token"] ||
    req.headers["x-vsx-secret"] ||
    url.searchParams.get("token") ||
    url.searchParams.get("secret") ||
    ""
  );
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json") || file.endsWith(".map")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".woff")) return "font/woff";
  if (file.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

const VSX_TOP_LEVEL = new Set(["css", "js", "vendor", "assets"]);
const VSX_FILES = new Set(["index.html", "manifest.json", "service-worker.js"]);

/**
 * Serve o próprio VSX pelo connector.
 *
 * No GitHub Pages (HTTPS) o navegador pode bloquear chamadas para
 * `http://<ip-da-rede>`. Abrindo `http://<ip>:8765/vsx/` o VSX e o connector
 * ficam na mesma origem, então o pareamento e o WebSocket funcionam sem
 * mixed content nem Private Network Access.
 */
async function serveVsx(req, res, url) {
  if (req.method !== "GET") throw new HttpError("Método não permitido", 405);

  if (url.pathname === "/vsx") {
    res.writeHead(302, { location: "/vsx/" }).end();
    return;
  }

  let relative = decodeURIComponent(url.pathname.replace(/^\/vsx\/?/, ""));
  if (!relative) relative = "index.html";

  const normalized = path.normalize(relative).replace(/\\/g, "/");
  const top = normalized.split("/")[0];
  if (
    normalized.startsWith("..") ||
    path.isAbsolute(normalized) ||
    (!VSX_FILES.has(normalized) && !VSX_TOP_LEVEL.has(top))
  ) {
    throw new HttpError("Arquivo não encontrado", 404);
  }

  const target = path.resolve(VSX_DIR, normalized);
  if (target !== VSX_DIR && !target.startsWith(VSX_DIR + path.sep)) {
    throw new HttpError("Caminho inválido", 403);
  }

  const data = await fs.promises.readFile(target).catch(() => null);
  if (!data) throw new HttpError("Arquivo não encontrado", 404);

  if (normalized === "index.html") {
    const scheme = req.socket?.encrypted ? "https" : "http";
    const origin = `${scheme}://${req.headers.host || "127.0.0.1"}`;
    const html = data
      .toString("utf8")
      .replace(
        "</head>",
        `<script>window.__EDUTERMINAL_LOCAL__=true;window.__EDUTERMINAL_URL__=${JSON.stringify(origin)};</script></head>`,
      );
    sendText(res, 200, html, contentType(target));
    return;
  }

  sendText(res, 200, data, contentType(target));
}

/**
 * Cria o servidor do EduTerminal sem escutar (bom para testes).
 *
 * O servidor é compatível com a API da ponte do VSX, então o VSX pode usá-lo
 * como workspace: repositórios, arquivos, git e terminal OpenCode.
 */
export function createEduTerminalServer(options = {}) {
  const config = { ...defaultConfig, ...(options.config || {}) };
  const pairing = options.pairing || new PairingManager(config);
  const sessions =
    options.sessions ||
    new SessionManager({
      shell: config.shell,
      shellArgs: config.shellArgs,
      maxSessions: config.maxSessions,
      onOutput: (session, data) => broadcast("session.output", { sessionId: session.id, data }),
      onExit: (session, info) =>
        broadcast("session.exit", {
          sessionId: session.id,
          code: info.code,
          signal: info.signal,
        }),
    });
  const opencode =
    options.opencode ||
    new OpenCode({ bin: config.opencodeBin, args: config.opencodeArgs });
  const tools = options.tools || new Tools();

  const state = {
    workspace: null,
    startedAt: Date.now(),
    pumpStarted: false,
  };

  const sseClients = new Set();
  const terminals = new Set();

  function actualPort() {
    const address = server.address();
    return address && typeof address === "object" ? address.port : config.port;
  }

  function requireToken(req, url) {
    const record = pairing.validate(tokenFrom(req, url));
    if (!record) throw new HttpError("Token do EduTerminal inválido ou expirado", 401);
    return record;
  }

  function requireAdmin(req) {
    const provided = req.headers["x-eduterminal-admin"];
    if (config.adminToken && provided && safeEqual(provided, config.adminToken)) return;
    if (isLoopback(req)) return;
    throw new HttpError(
      "Somente o próprio dispositivo (ou um token administrativo) pode aprovar o pareamento",
      403,
    );
  }

  function workspaceRoot() {
    if (!state.workspace) throw new ws.WorkspaceError("Nenhum workspace aberto", 400);
    return state.workspace.path;
  }

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        // cliente caiu; o cleanup do SSE remove
      }
    }
    if (event.startsWith("session.")) {
      for (const connection of terminals) connection.send({ type: event, ...data });
    }
  }

  async function pumpOpenCodeEvents() {
    if (!state.pumpStarted) return;
    try {
      const res = await opencode.events();
      if (!res.ok || !res.body) throw new Error(`stream do OpenCode indisponível (${res.status})`);
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
            broadcast("opencode", JSON.parse(match[1]));
          } catch {
            // evento parcial/desconhecido
          }
        }
      }
    } catch (error) {
      broadcast("opencode.error", { message: error.message });
    }
    if (state.pumpStarted) {
      const delay = opencode.unavailableReason ? 20_000 : 4_000;
      setTimeout(pumpOpenCodeEvents, delay).unref?.();
    }
  }

  function startOpenCodePump() {
    if (state.pumpStarted) return;
    state.pumpStarted = true;
    pumpOpenCodeEvents();
  }

  function handleStream(req, res, url) {
    requireToken(req, url);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 2000\n\n");
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, eduterminal: true })}\n\n`);
    sseClients.add(res);
    startOpenCodePump();

    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        // ignore
      }
    }, 20_000);

    const cleanup = () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
  }

  async function serveStatic(req, res, url) {
    if (req.method !== "GET") throw new HttpError("Método não permitido", 405);
    const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const target = path.resolve(PUBLIC_DIR, requested);
    if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
      throw new HttpError("Caminho inválido", 403);
    }
    const data = await fs.promises.readFile(target).catch(() => null);
    if (!data) throw new HttpError("Página não encontrada", 404);
    sendText(res, 200, data, contentType(target));
  }

  /* ------------------------------------------------------------------ rotas */

  const routes = {
    "GET /health": () => ({
      ok: true,
      name: "eduterminal",
      version: config.version,
      pid: process.pid,
      uptime: Date.now() - state.startedAt,
    }),

    /**
     * A API da ponte do VSX. Sem token responde 401, e o VSX entende que
     * precisa do token de pareamento (o mesmo campo "senha" da ponte).
     */
    "GET /api/bridge/info": () => ({
      name: "vsx-bridge",
      version: config.version,
      eduterminal: true,
      pid: process.pid,
      host: config.host,
      port: actualPort(),
      requiresSecret: true,
      connected: true,
      user: null,
      opencode: { running: opencode.running, url: opencode.url },
      workspaceDir: config.workspaceDir,
      allowedOrigins: config.allowedOrigins,
      pairing: { available: true },
    }),

    "GET /api/state": () => ({
      connected: true,
      eduterminal: true,
      user: null,
      workspace: state.workspace,
    }),

    /* ------------------------------------------------------------- pareamento */

    "POST /api/eduterminal/pairing/start": async (req) => {
      requireAdmin(req);
      const body = await readJson(req);
      return pairing.startPairing({ label: body.label || "EduTerminal" });
    },

    "GET /api/eduterminal/pairing/current": (req) => {
      requireAdmin(req);
      return pairing.current() || { code: null };
    },

    "POST /api/eduterminal/pairing/cancel": (req) => {
      requireAdmin(req);
      pairing.cancelPairing();
      return { ok: true };
    },

    "POST /api/eduterminal/pair/request": async (req) => {
      const body = await readJson(req);
      return pairing.request({
        code: body.code,
        name: body.name,
        ip: req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
      });
    },

    "GET /api/eduterminal/pair/status": (req, res, url) => {
      const requestId = url.searchParams.get("requestId");
      if (!requestId) throw new HttpError("Informe requestId", 400);
      return pairing.status(requestId);
    },

    "GET /api/eduterminal/requests": (req) => {
      requireAdmin(req);
      return { requests: pairing.pendingRequests() };
    },

    "POST /api/eduterminal/pair/approve": async (req) => {
      requireAdmin(req);
      const body = await readJson(req);
      if (!body.requestId) throw new HttpError("Informe requestId", 400);
      return pairing.approve(body.requestId, { approve: true, by: "android" });
    },

    "POST /api/eduterminal/pair/deny": async (req) => {
      requireAdmin(req);
      const body = await readJson(req);
      if (!body.requestId) throw new HttpError("Informe requestId", 400);
      return pairing.approve(body.requestId, { approve: false, by: "android" });
    },

    "GET /api/eduterminal/tokens": (req) => {
      requireAdmin(req);
      return { tokens: pairing.listTokens() };
    },

    "DELETE /api/eduterminal/tokens": async (req) => {
      requireAdmin(req);
      const body = await readJson(req);
      pairing.revoke(body.id || body.token);
      return { ok: true };
    },

    /* --------------------------------------------------------------- status */

    "GET /api/eduterminal/status": () => ({
      version: config.version,
      uptime: Date.now() - state.startedAt,
      host: config.host,
      port: actualPort(),
      workspace: state.workspace,
      sessions: sessions.list(),
      opencode: { running: opencode.running, url: opencode.url },
      pairing: { autoApprove: pairing.autoApprove },
      workspaceDir: config.workspaceDir,
    }),

    "GET /api/eduterminal/sessions": () => ({ sessions: sessions.list() }),

    "POST /api/eduterminal/sessions": async (req) => {
      const body = await readJson(req);
      return {
        session: await sessions.create({
          ...body,
          cwd: body.cwd || state.workspace?.path,
        }),
      };
    },

    "DELETE /api/eduterminal/sessions": (req, res, url) => {
      const id = url.searchParams.get("id");
      if (!id) throw new HttpError("Informe o id da sessão", 400);
      return sessions.close(id);
    },

    "GET /api/eduterminal/tools": async () => ({ tools: await tools.list() }),

    "POST /api/eduterminal/tools/install": async (req) => {
      const body = await readJson(req);
      if (!body.id) throw new HttpError("Informe a ferramenta", 400);
      return tools.install(body.id);
    },

    /* ------------------------------------------------------------ workspace */

    "POST /api/workspace/open": async (req) => {
      const body = await readJson(req);
      const githubToken = req.headers["x-vsx-token"] || null;
      let result;
      let repo;

      if (body.path) {
        result = await ws.openLocal(body.path);
        repo = {
          fullName: body.repo || path.basename(result.path),
          branch: await ws.currentBranch(result.path),
          path: result.path,
          defaultBranch: null,
          permissions: { push: true, pull: true, admin: false },
          local: true,
        };
      } else {
        if (!body.repo) throw new ws.WorkspaceError("Informe o repositório ou o caminho da pasta");
        const info = githubToken ? await gh.getRepo(githubToken, body.repo).catch(() => null) : null;
        result = await ws.openWorkspace({
          fullName: body.repo,
          branch: body.branch,
          token: githubToken,
          cfg: config,
        });
        const branch = await ws.currentBranch(result.path);
        repo = {
          fullName: body.repo,
          branch,
          path: result.path,
          defaultBranch: info?.defaultBranch || branch,
          permissions: info?.permissions || { push: true, pull: true, admin: false },
        };
      }

      state.workspace = repo;
      const files = await ws.listFiles(result.path);
      const status = await ws.gitStatus(result.path);
      broadcast("workspace.opened", { repo, files });
      return {
        repo,
        files,
        status,
        cloned: Boolean(result.cloned),
        updated: Boolean(result.updated),
        pullMessage: result.pullMessage || null,
      };
    },

    "GET /api/workspace/files": async () => ({ files: await ws.listFiles(workspaceRoot()) }),

    "GET /api/workspace/file": async (req, res, url) => {
      const file = url.searchParams.get("path");
      if (!file) throw new ws.WorkspaceError("Informe o caminho do arquivo");
      return ws.readFile(workspaceRoot(), file);
    },

    "PUT /api/workspace/file": async (req) => {
      const body = await readJson(req);
      if (!body.path) throw new ws.WorkspaceError("Informe o caminho do arquivo");
      const result = await ws.writeFile(workspaceRoot(), body.path, body.content);
      broadcast("git.status", {
        entries: await ws.gitStatus(workspaceRoot()),
        branch: await ws.currentBranch(workspaceRoot()),
      });
      return result;
    },

    "POST /api/workspace/new": async (req) => {
      const body = await readJson(req);
      if (!body.path) throw new ws.WorkspaceError("Informe o caminho do arquivo");
      return ws.createFile(workspaceRoot(), body.path, body.content ?? "");
    },

    "DELETE /api/workspace/file": async (req) => {
      const body = await readJson(req);
      if (!body.path) throw new ws.WorkspaceError("Informe o caminho do arquivo");
      return ws.removeFile(workspaceRoot(), body.path);
    },

    "GET /api/workspace/status": async () => ({
      entries: await ws.gitStatus(workspaceRoot()),
      branch: await ws.currentBranch(workspaceRoot()),
      branches: await ws.localBranches(workspaceRoot()),
    }),

    "GET /api/workspace/diff": async (req, res, url) => {
      const file = url.searchParams.get("path");
      if (!file) throw new ws.WorkspaceError("Informe o caminho do arquivo");
      return ws.diffFile(workspaceRoot(), file);
    },

    "POST /api/workspace/commit": async (req) => {
      const body = await readJson(req);
      return ws.commitAndPush(workspaceRoot(), {
        message: body.message,
        branch: body.branch,
        token: req.headers["x-vsx-token"] || null,
      });
    },

    "POST /api/workspace/discard": async (req) => {
      const body = await readJson(req);
      return ws.discardChanges(workspaceRoot(), body.path);
    },

    /* -------------------------------------------------------------- GitHub */

    "GET /api/github/repos": async (req) => ({
      repos: await gh.listRepos(req.headers["x-vsx-token"] || null),
    }),

    "GET /api/github/branches": async (req, res, url) => {
      const repo = url.searchParams.get("repo") || state.workspace?.fullName;
      if (!repo) throw new HttpError("Informe o repositório", 400);
      return {
        branches: await gh.listBranches(req.headers["x-vsx-token"] || null, repo),
      };
    },

    /* ------------------------------------------------------------- OpenCode */

    "GET /api/opencode/status": async () => {
      if (!opencode.running) await opencode.start();
      return { running: opencode.running, url: opencode.url, info: await opencode.info() };
    },

    "GET /api/opencode/session": async () => {
      const root = workspaceRoot();
      const session = await opencode.sessionFor(root, {
        title: `vsx: ${state.workspace.fullName}`,
      });
      return {
        session,
        models: await opencode.models(root),
        agents: await opencode.agents(root),
      };
    },

    "POST /api/opencode/session/new": async (req) => {
      const root = workspaceRoot();
      const body = await readJson(req);
      const existing = await opencode.listSessions(root);
      for (const session of existing) {
        if (!session.parentID) await opencode.deleteSession(session.id).catch(() => {});
      }
      opencode.forgetSession(root);
      const session = await opencode.sessionFor(root, {
        title: `vsx: ${state.workspace.fullName}`,
        agent: body.agent,
        model: body.model,
      });
      return { session };
    },

    "POST /api/opencode/prompt": async (req) => {
      const root = workspaceRoot();
      const body = await readJson(req);
      if (!body.text || !body.text.trim()) throw new ws.WorkspaceError("Mensagem vazia");
      const session = await opencode.sessionFor(root, {
        title: `vsx: ${state.workspace.fullName}`,
      });
      const result = await opencode.prompt(session.id, {
        text: body.text,
        files: body.files,
      });
      return { session, message: result };
    },

    "POST /api/opencode/interrupt": async () => {
      const root = workspaceRoot();
      const session = await opencode.sessionFor(root);
      return opencode.interrupt(session.id);
    },

    "GET /api/opencode/permission": async () => {
      const root = workspaceRoot();
      const session = await opencode.sessionFor(root);
      return { permissions: await opencode.permissions(session.id) };
    },

    "POST /api/opencode/permission": async (req) => {
      const root = workspaceRoot();
      const body = await readJson(req);
      if (!body.requestID || !body.decision) {
        throw new ws.WorkspaceError("Informe requestID e decision");
      }
      const session = await opencode.sessionFor(root);
      await opencode.replyPermission(session.id, body.requestID, body.decision, body.message);
      return { ok: true };
    },

    "POST /api/opencode/model": async (req) => {
      const root = workspaceRoot();
      const body = await readJson(req);
      if (!body.model) throw new ws.WorkspaceError("Informe o modelo");
      const session = await opencode.sessionFor(root);
      await opencode.setModel(session.id, body.model);
      return { ok: true, model: body.model };
    },

    "POST /api/opencode/agent": async (req) => {
      const root = workspaceRoot();
      const body = await readJson(req);
      if (!body.agent) throw new ws.WorkspaceError("Informe o agente");
      const session = await opencode.sessionFor(root);
      await opencode.setAgent(session.id, body.agent);
      return { ok: true, agent: body.agent };
    },

    "GET /api/opencode/messages": async () => {
      const root = workspaceRoot();
      const session = await opencode.sessionFor(root);
      return { messages: await opencode.messages(session.id) };
    },
  };

  /* ------------------------------------------------------------------ HTTP */

  async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch {
      sendJson(res, 400, { error: "URL inválida" });
      return;
    }

    const allowedOrigin = setCors(res, req.headers.origin, config.allowedOrigins);
    if (req.method === "OPTIONS") {
      res.writeHead(allowedOrigin ? 204 : 403).end();
      return;
    }

    try {
      if (url.pathname === "/ws") {
        throw new HttpError("Use WebSocket em /ws", 400);
      }

      if (url.pathname === "/api/stream") {
        handleStream(req, res, url);
        return;
      }

      if (url.pathname === "/vsx" || url.pathname.startsWith("/vsx/")) {
        await serveVsx(req, res, url);
        return;
      }

      const key = `${req.method} ${url.pathname}`;
      const route = routes[key];

      if (!route) {
        if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
          await serveStatic(req, res, url);
          return;
        }
        throw new HttpError("Rota não encontrada", 404);
      }

      if (ADMIN_ROUTES.has(key)) requireAdmin(req);
      else if (!PUBLIC_ROUTES.has(key)) requireToken(req, url);

      const result = await route(req, res, url);
      if (result !== undefined && !res.writableEnded) sendJson(res, 200, result);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) log("erro:", error.message);
      if (!res.writableEnded) {
        sendJson(res, status, { error: error.message || "Erro interno" });
      }
    }
  }

  const server =
    config.tlsKey && config.tlsCert
      ? https.createServer(
          {
            key: fs.readFileSync(config.tlsKey),
            cert: fs.readFileSync(config.tlsCert),
          },
          handler,
        )
      : http.createServer(handler);

  /* -------------------------------------------------------------- WebSocket */

  const wsServer = new WsServer({
    path: "/ws",
    onConnection(connection, req, url) {
      let authenticated = false;
      const authTimer = setTimeout(() => {
        if (!authenticated) connection.close(4001, "auth timeout");
      }, 10_000);
      authTimer.unref?.();

      function authenticate(token) {
        const record = pairing.validate(token);
        if (!record) {
          connection.send({ type: "auth.error", error: "Token inválido ou expirado" });
          connection.close(4003, "unauthorized");
          return false;
        }
        authenticated = true;
        clearTimeout(authTimer);
        terminals.add(connection);
        connection.send({
          type: "auth.ok",
          version: config.version,
          sessionLimit: config.maxSessions,
        });
        return true;
      }

      connection.send({
        type: "hello",
        name: "eduterminal",
        version: config.version,
        requiresAuth: true,
      });

      const fromQuery = url.searchParams.get("token") || url.searchParams.get("secret");
      if (fromQuery) authenticate(fromQuery);

      connection.onMessage = async (data, isBinary) => {
        if (isBinary) {
          connection.send({ type: "error", error: "Mensagens binárias não são suportadas" });
          return;
        }

        let message;
        try {
          message = JSON.parse(data);
        } catch {
          connection.send({ type: "error", error: "JSON inválido" });
          return;
        }

        if (!authenticated) {
          if (message.type === "auth") authenticate(message.token);
          else connection.send({ type: "auth.required" });
          return;
        }

        try {
          switch (message.type) {
            case "ping":
              connection.send({ type: "pong", t: message.t || Date.now() });
              break;

            case "session.list":
              connection.send({ type: "session.list", sessions: sessions.list() });
              break;

            case "session.create": {
              const session = await sessions.create({
                name: message.name,
                cwd: message.cwd || state.workspace?.path,
                cols: message.cols,
                rows: message.rows,
                shell: message.shell,
                args: message.args,
              });
              connection.send({ type: "session.created", session });
              break;
            }

            case "session.input":
              sessions.write(message.sessionId, message.data);
              break;

            case "session.resize":
              sessions.resize(message.sessionId, message.cols, message.rows);
              break;

            case "session.close":
              sessions.close(message.sessionId);
              break;

            default:
              connection.send({ type: "error", error: `Tipo desconhecido: ${message.type}` });
          }
        } catch (error) {
          connection.send({ type: "error", error: error.message || "Erro na sessão" });
        }
      };

      connection.onClose = () => {
        clearTimeout(authTimer);
        terminals.delete(connection);
      };

      connection.req = req;
    },
  });

  wsServer.attach(server);

  /* --------------------------------------------------------------- ciclo */

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen(config.port, config.host, () => {
        server.off("error", onError);
        resolve(server.address());
      });
    });
  }

  async function close() {
    state.pumpStarted = false;
    for (const connection of terminals) connection.close(1001, "servidor encerrado");
    terminals.clear();
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
    sessions.closeAll();
    opencode.stop();
    pairing.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    server,
    config,
    state,
    pairing,
    sessions,
    opencode,
    tools,
    listen,
    close,
    broadcast,
    actualPort,
  };
}
