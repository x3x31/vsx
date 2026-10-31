import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { randomToken } from "./util.mjs";

export class SessionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SessionError";
    this.status = status;
  }
}

let ptyPromise = null;

/** `node-pty` é opcional: quando existe, o terminal é completo (TTY real). */
async function loadPty() {
  if (!ptyPromise) {
    ptyPromise = import("node-pty").catch(() => null);
  }
  return ptyPromise;
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Sessões de shell do EduTerminal.
 *
 * Sem `node-pty` o connector usa pipes (funciona para comandos, mas sem
 * controle de terminal). No Termux o recomendado é instalar `node-pty`
 * (ou usar o `ttyd` como backend na próxima etapa).
 */
export class SessionManager {
  #sessions = new Map();

  constructor({ shell, shellArgs, maxSessions = 4, onOutput, onExit, env } = {}) {
    this.shell = shell || (process.platform === "win32" ? "powershell.exe" : "bash");
    this.shellArgs =
      shellArgs || (process.platform === "win32" ? ["-NoLogo", "-NoProfile", "-Command", "-"] : ["-i"]);
    this.maxSessions = maxSessions;
    this.onOutput = onOutput || (() => {});
    this.onExit = onExit || (() => {});
    this.env = env || process.env;
  }

  list() {
    return [...this.#sessions.values()].map((session) => this.#public(session));
  }

  get(id) {
    const session = this.#sessions.get(id);
    return session ? this.#public(session) : null;
  }

  async create({ name, cwd, cols = 80, rows = 24, shell, args } = {}) {
    if (this.#sessions.size >= this.maxSessions) {
      throw new SessionError(
        `Limite de ${this.maxSessions} sessões simultâneas atingido`,
        429,
      );
    }

    const workdir = this.#resolveCwd(cwd);
    const useShell = shell || this.shell;
    const useArgs = args || this.shellArgs;
    const pty = await loadPty();

    const id = randomToken(12);
    const session = {
      id,
      name: String(name || `sessão ${this.#sessions.size + 1}`).slice(0, 60),
      shell: useShell,
      cwd: workdir,
      cols: clamp(cols, 20, 500, 80),
      rows: clamp(rows, 5, 200, 24),
      createdAt: Date.now(),
      pid: null,
      alive: true,
      pty: Boolean(pty),
      proc: null,
      exited: false,
    };

    if (pty) {
      const proc = pty.spawn(useShell, useArgs, {
        name: "xterm-256color",
        cols: session.cols,
        rows: session.rows,
        cwd: workdir,
        env: { ...this.env, TERM: "xterm-256color" },
      });
      session.proc = proc;
      session.pid = proc.pid;
      proc.onData((data) => {
        if (session.alive) this.onOutput(session, data);
      });
      proc.onExit(({ exitCode, signal }) => this.#finish(session, exitCode, signal));
    } else {
      const proc = spawn(useShell, useArgs, {
        cwd: workdir,
        env: { ...this.env, TERM: "xterm-256color" },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      session.proc = proc;
      session.pid = proc.pid || null;

      const forward = (chunk) => {
        if (session.alive) this.onOutput(session, chunk.toString("utf8"));
      };
      proc.stdout?.on("data", forward);
      proc.stderr?.on("data", forward);
      proc.on("error", (err) => {
        this.onOutput(session, `\r\n[eduterminal] ${err.message}\r\n`);
        this.#finish(session, 1, null);
      });
      proc.on("exit", (code, signal) => this.#finish(session, code, signal));
    }

    this.#sessions.set(id, session);
    return this.#public(session);
  }

  write(id, data) {
    const session = this.#sessions.get(id);
    if (!session || !session.alive) throw new SessionError("Sessão não encontrada", 404);
    const payload = String(data ?? "");
    if (session.pty) session.proc.write(payload);
    else session.proc.stdin?.write(payload);
    return { ok: true };
  }

  resize(id, cols, rows) {
    const session = this.#sessions.get(id);
    if (!session || !session.alive) throw new SessionError("Sessão não encontrada", 404);
    session.cols = clamp(cols, 20, 500, session.cols);
    session.rows = clamp(rows, 5, 200, session.rows);
    if (session.pty) {
      try {
        session.proc.resize(session.cols, session.rows);
      } catch {
        // alguns terminais não aceitam resize; o cliente pode reenviar
      }
    }
    return { ok: true, cols: session.cols, rows: session.rows };
  }

  close(id) {
    const session = this.#sessions.get(id);
    if (!session) return { ok: true };
    try {
      if (session.pty) session.proc.kill();
      else session.proc.kill("SIGTERM");
    } catch {
      // processo já saiu
    }
    this.#finish(session, 0, "SIGTERM");
    return { ok: true };
  }

  closeAll() {
    for (const id of [...this.#sessions.keys()]) this.close(id);
  }

  #finish(session, code = 0, signal = null) {
    if (session.exited) return;
    session.exited = true;
    session.alive = false;
    this.#sessions.delete(session.id);
    try {
      this.onExit(session, { code, signal });
    } catch {
      // não deixa um erro de callback derrubar o servidor
    }
  }

  #resolveCwd(cwd) {
    const target = cwd || os.homedir();
    try {
      if (!fs.statSync(target).isDirectory()) throw new Error("não é pasta");
      return target;
    } catch {
      throw new SessionError(`Pasta da sessão não encontrada: ${target}`, 404);
    }
  }

  #public(session) {
    return {
      id: session.id,
      name: session.name,
      shell: session.shell,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      createdAt: session.createdAt,
      pid: session.pid,
      alive: session.alive,
      pty: session.pty,
    };
  }
}
