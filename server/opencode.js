import { spawn } from "node:child_process";
import net from "node:net";

const HOST = "127.0.0.1";

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export class OpenCodeError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "OpenCodeError";
    this.status = status;
  }
}

/**
 * Gerencia um servidor OpenCode dedicado (spawn de `opencode serve`).
 * A senha e lida da saida do processo e usada como Basic auth.
 */
export class OpenCode {
  #child = null;
  #password = null;
  #url = null;
  #starting = null;
  #sessions = new Map();
  #unavailable = null;

  get url() {
    return this.#url;
  }

  get running() {
    return Boolean(this.#child && !this.#child.killed) && Boolean(this.#url);
  }

  /** Mensagem amigavel quando o binario do opencode nao esta instalado. */
  get unavailableReason() {
    return this.#unavailable;
  }

  async start() {
    if (this.running) return this.#url;
    if (this.#unavailable) throw new OpenCodeError(this.#unavailable, 503);
    if (this.#starting) return this.#starting;

    this.#starting = (async () => {
      const port = await freePort();

      let child;
      try {
        child = spawn("opencode", ["serve", "--hostname", HOST, "--port", String(port)], {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });
      } catch (err) {
        throw new OpenCodeError(`Nao foi possivel iniciar o OpenCode: ${err.message}`, 503);
      }

      child.on("error", (err) => {
        if (err.code === "ENOENT") {
          this.#unavailable =
            "O executavel 'opencode' nao foi encontrado no PATH. Instale o OpenCode para usar o terminal.";
        }
      });

      const password = await new Promise((resolve, reject) => {
        let buffer = "";
        const timer = setTimeout(() => reject(new Error("Tempo esgotado ao iniciar o OpenCode")), 30000);

        const onData = (chunk) => {
          buffer += chunk.toString();
          const match = buffer.match(/server password (\S+)/);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        };

        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`O servidor OpenCode encerrou (codigo ${code})`));
        });
      });

      this.#child = child;
      this.#password = password;
      this.#url = `http://${HOST}:${port}`;

      child.on("exit", () => {
        this.#child = null;
        this.#url = null;
        this.#password = null;
      });

      return this.#url;
    })();

    try {
      return await this.#starting;
    } catch (err) {
      if (err instanceof OpenCodeError) throw err;
      if (err.code === "ENOENT") {
        this.#unavailable =
          "O executavel 'opencode' nao foi encontrado no PATH. Instale o OpenCode para usar o terminal.";
        throw new OpenCodeError(this.#unavailable, 503);
      }
      throw new OpenCodeError(`Falha ao iniciar o OpenCode: ${err.message}`, 503);
    } finally {
      this.#starting = null;
    }
  }

  stop() {
    if (this.#child) {
      this.#child.kill("SIGTERM");
      this.#child = null;
    }
    this.#url = null;
    this.#password = null;
  }

  get authHeader() {
    return `Basic ${Buffer.from(`opencode:${this.#password}`).toString("base64")}`;
  }

  async request(method, endpoint, { body, headers = {}, raw = false } = {}) {
    if (!this.running) await this.start();

    const init = {
      method,
      headers: {
        authorization: this.authHeader,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);

    const res = await fetch(`${this.#url}${endpoint}`, init);
    if (raw) return res;

    const text = await res.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!res.ok) {
      const message =
        (payload && payload.message) || (typeof payload === "string" ? payload : `OpenCode respondeu ${res.status}`);
      throw new OpenCodeError(message, res.status);
    }
    return payload;
  }

  /** Stream de eventos (SSE) do OpenCode. */
  async events() {
    if (!this.running) await this.start();
    return fetch(`${this.#url}/api/event`, {
      headers: { authorization: this.authHeader, accept: "text/event-stream" },
    });
  }

  async info() {
    return this.request("GET", "/api/info");
  }

  async models(directory) {
    const query = directory ? `?location[directory]=${encodeURIComponent(directory)}` : "";
    const result = await this.request("GET", `/api/model${query}`);
    return result?.data ?? result ?? [];
  }

  async agents(directory) {
    const query = directory ? `?location[directory]=${encodeURIComponent(directory)}` : "";
    const result = await this.request("GET", `/api/agent${query}`);
    return result?.data ?? result ?? [];
  }

  async createSession({ directory, title, agent, model }) {
    const payload = { location: { directory } };
    if (title) payload.title = title;
    if (agent) payload.agent = agent;
    if (model) payload.model = model;
    const result = await this.request("POST", "/api/session", { body: payload });
    return result?.data ?? result;
  }

  async listSessions(directory) {
    const query = directory ? `?directory=${encodeURIComponent(directory)}` : "";
    const result = await this.request("GET", `/api/session${query}`);
    const list = result?.data ?? [];
    return Array.isArray(list) ? list : [];
  }

  async getSession(sessionID) {
    const result = await this.request("GET", `/api/session/${sessionID}`);
    return result?.data ?? result;
  }

  async deleteSession(sessionID) {
    return this.request("DELETE", `/api/session/${sessionID}`);
  }

  async prompt(sessionID, { text, files, delivery }) {
    const payload = { text };
    if (files?.length) payload.files = files;
    if (delivery) payload.delivery = delivery;
    const result = await this.request("POST", `/api/session/${sessionID}/prompt`, { body: payload });
    return result?.data ?? result;
  }

  async interrupt(sessionID) {
    return this.request("POST", `/api/session/${sessionID}/interrupt`, { body: {} });
  }

  async setModel(sessionID, model) {
    return this.request("POST", `/api/session/${sessionID}/model`, { body: { model } });
  }

  async setAgent(sessionID, agent) {
    return this.request("POST", `/api/session/${sessionID}/agent`, { body: { agent } });
  }

  async messages(sessionID) {
    const result = await this.request("GET", `/api/session/${sessionID}/message`);
    return result?.data ?? [];
  }

  async permissions(sessionID) {
    const result = await this.request("GET", `/api/session/${sessionID}/permission`);
    return result?.data ?? [];
  }

  async replyPermission(sessionID, requestID, decision, message) {
    const body = { decision };
    if (message) body.message = message;
    return this.request("POST", `/api/session/${sessionID}/permission/${requestID}/reply`, { body });
  }

  /** Sessao ativa de um workspace (criada sob demanda, reaproveitada entre recargas). */
  async sessionFor(directory, { title, agent, model, create = true } = {}) {
    const cached = this.#sessions.get(directory);
    if (cached) {
      try {
        const session = await this.getSession(cached);
        if (session) return session;
      } catch {
        this.#sessions.delete(directory);
      }
    }

    const sessions = await this.listSessions(directory);
    const existing = sessions.find((s) => !s.parentID);
    if (existing) {
      this.#sessions.set(directory, existing.id);
      return existing;
    }

    if (!create) return null;

    const session = await this.createSession({ directory, title, agent, model });
    this.#sessions.set(directory, session.id);
    return session;
  }

  forgetSession(directory) {
    this.#sessions.delete(directory);
  }
}
