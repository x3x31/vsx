import fs from "node:fs";
import path from "node:path";
import { config as defaultConfig, pairingFile } from "./config.mjs";
import { hashToken, randomCode, randomToken } from "./util.mjs";

export class PairingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PairingError";
    this.status = status;
  }
}

/**
 * Pareamento VSX <-> EduTerminal.
 *
 * 1. O EduTerminal gera um código de 6 dígitos (curto prazo).
 * 2. O VSX envia o código e cria um pedido de autorização.
 * 3. O estudante aprova no próprio dispositivo.
 * 4. O VSX troca o pedido aprovado por um token com validade limitada.
 *
 * Nenhum token é aceito sem ter passado por esse fluxo (a menos que o modo
 * `autoApprove` esteja ligado, usado só em desenvolvimento/testes).
 */
export class PairingManager {
  #codes = new Map();
  #requests = new Map();
  #tokens = new Map();

  constructor(options = {}) {
    this.cfg = { ...defaultConfig, ...options };
    this.autoApprove = Boolean(options.autoApprove ?? this.cfg.autoApprove);
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref?.();
  }

  /* ------------------------------------------------------------- códigos */

  startPairing({ label = "EduTerminal" } = {}) {
    const now = Date.now();
    const code = randomCode();
    const entry = {
      code,
      label,
      createdAt: now,
      expiresAt: now + this.cfg.pairingTtlMs,
      used: false,
    };
    this.#codes.set(code, entry);
    this.#writeCurrent(entry);
    return { code, label, expiresAt: entry.expiresAt, ttlMs: this.cfg.pairingTtlMs };
  }

  /** Código atual ainda válido (para a interface do APK). */
  current() {
    for (const entry of this.#codes.values()) {
      if (!entry.used && entry.expiresAt > Date.now()) {
        return { code: entry.code, label: entry.label, expiresAt: entry.expiresAt };
      }
    }
    return null;
  }

  cancelPairing() {
    this.#codes.clear();
    this.#writeCurrent(null);
  }

  /* -------------------------------------------------------------- pedidos */

  request({ code, name = "VSX", ip = null, userAgent = null } = {}) {
    const normalized = String(code || "").replace(/\D/g, "");
    if (normalized.length !== 6) throw new PairingError("O código deve ter 6 dígitos", 400);

    const entry = this.#codes.get(normalized);
    if (!entry) throw new PairingError("Código de pareamento inválido", 404);
    if (entry.expiresAt <= Date.now()) {
      this.#codes.delete(normalized);
      throw new PairingError("O código de pareamento expirou", 410);
    }
    if (entry.used) throw new PairingError("Este código já foi utilizado", 409);

    entry.used = true;
    this.#writeCurrent(null);

    const now = Date.now();
    const request = {
      id: randomToken(18),
      code: normalized,
      name: String(name || "VSX").slice(0, 80),
      ip,
      userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
      status: "pending",
      createdAt: now,
      expiresAt: now + this.cfg.requestTtlMs,
      token: null,
      tokenExpiresAt: null,
    };

    if (this.autoApprove) this.#approve(request, "auto");

    this.#requests.set(request.id, request);
    return {
      requestId: request.id,
      status: request.status,
      expiresAt: request.expiresAt,
      token: request.token,
      tokenExpiresAt: request.tokenExpiresAt,
    };
  }

  approve(requestId, { approve = true, by = "local" } = {}) {
    const request = this.#requests.get(requestId);
    if (!request) throw new PairingError("Pedido de pareamento não encontrado", 404);
    if (request.expiresAt <= Date.now()) {
      request.status = "expired";
      throw new PairingError("O pedido de pareamento expirou", 410);
    }
    if (request.status !== "pending") {
      return { status: request.status, token: request.token, tokenExpiresAt: request.tokenExpiresAt };
    }
    if (!approve) {
      request.status = "denied";
      return { status: request.status };
    }
    this.#approve(request, by);
    return { status: request.status, token: request.token, tokenExpiresAt: request.tokenExpiresAt };
  }

  status(requestId) {
    const request = this.#requests.get(requestId);
    if (!request) throw new PairingError("Pedido de pareamento não encontrado", 404);
    if (request.status === "pending" && request.expiresAt <= Date.now()) {
      request.status = "expired";
    }
    return {
      requestId,
      name: request.name,
      status: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      token: request.status === "approved" ? request.token : null,
      tokenExpiresAt: request.tokenExpiresAt,
    };
  }

  pendingRequests() {
    const now = Date.now();
    return [...this.#requests.values()]
      .filter((request) => {
        if (request.status === "pending" && request.expiresAt <= now) {
          request.status = "expired";
        }
        return request.status === "pending";
      })
      .map((request) => ({
        requestId: request.id,
        name: request.name,
        ip: request.ip,
        userAgent: request.userAgent,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
      }));
  }

  /* --------------------------------------------------------------- tokens */

  validate(token) {
    if (!token) return null;
    const record = this.#tokens.get(hashToken(token));
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      this.#tokens.delete(hashToken(token));
      return null;
    }
    record.lastUsedAt = Date.now();
    return record;
  }

  listTokens() {
    return [...this.#tokens.values()].map((record) => ({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
    }));
  }

  revoke(tokenOrId) {
    for (const [hash, record] of this.#tokens) {
      if (record.id === tokenOrId || hash === hashToken(tokenOrId)) {
        this.#tokens.delete(hash);
        return true;
      }
    }
    return false;
  }

  revokeAll() {
    this.#tokens.clear();
  }

  /* --------------------------------------------------------------- limpeza */

  sweep() {
    const now = Date.now();
    for (const [code, entry] of this.#codes) {
      if (entry.expiresAt <= now || entry.used) this.#codes.delete(code);
    }
    for (const [id, request] of this.#requests) {
      if (request.expiresAt + 60_000 <= now) this.#requests.delete(id);
    }
    for (const [hash, record] of this.#tokens) {
      if (record.expiresAt <= now) this.#tokens.delete(hash);
    }
  }

  close() {
    clearInterval(this.timer);
  }

  /* --------------------------------------------------------------- interno */

  #approve(request, by) {
    const token = randomToken(32);
    const now = Date.now();
    const record = {
      id: randomToken(8),
      name: request.name,
      createdAt: now,
      expiresAt: now + this.cfg.tokenTtlMs,
      lastUsedAt: null,
      approvedBy: by,
    };
    this.#tokens.set(hashToken(token), record);
    request.status = "approved";
    request.token = token;
    request.tokenExpiresAt = record.expiresAt;
    request.approvedBy = by;
  }

  #writeCurrent(entry) {
    try {
      fs.mkdirSync(this.cfg.configDir, { recursive: true, mode: 0o700 });
      const file = pairingFile(this.cfg);
      const payload = entry
        ? {
            code: entry.code,
            label: entry.label,
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt,
          }
        : { code: null };
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
    } catch {
      // o código também fica em memória; falhar ao gravar não impede o fluxo
    }
  }
}

export function readCurrentPairing(cfg = defaultConfig) {
  try {
    const raw = fs.readFileSync(pairingFile(cfg), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
