const STORAGE_KEY = "vsx.eduterminal";

export function loadEduTerminal() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved?.url) return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveEduTerminal(config) {
  if (!config) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  return config;
}

/** Aceita `host`, `host:porta`, `http://...` ou `https://...`. */
export function normalizeEduTerminalUrl(value) {
  let url = (value || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

function describeNetworkError(url, cause) {
  const error = new Error(
    `Não foi possível falar com o EduTerminal em ${url}. ` +
      "Confira se o servidor está iniciado, se o celular e o computador estão na mesma rede " +
      "e se o navegador não bloqueou a conexão (páginas HTTPS podem bloquear http:// na rede local).",
  );
  error.status = 0;
  error.cause = cause;
  return error;
}

/**
 * Cliente do EduTerminal.
 *
 * O pareamento tem duas etapas: o VSX cria um pedido com o código de 6
 * dígitos e aguarda a autorização no próprio dispositivo; só então recebe
 * o token (com validade limitada) que abre a API do connector.
 */
export class EduTerminalClient {
  constructor() {
    this.saved = loadEduTerminal();
    this.url = this.saved?.url || "";
    this.token = this.saved?.token || "";
    this.name = this.saved?.name || "";
  }

  get connected() {
    return Boolean(this.saved?.url && this.saved?.token);
  }

  save({ url, token, name }) {
    this.url = normalizeEduTerminalUrl(url);
    this.token = token || "";
    this.name = name || this.name || "";
    this.saved = saveEduTerminal({
      url: this.url,
      token: this.token,
      name: this.name,
      savedAt: Date.now(),
    });
    return this.saved;
  }

  clear() {
    this.url = "";
    this.token = "";
    this.name = "";
    this.saved = saveEduTerminal(null);
  }

  async request(method, path, body, { url = this.url, token = this.token } = {}) {
    const target = normalizeEduTerminalUrl(url);
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers["x-vsx-secret"] = token;

    let response;
    try {
      response = await fetch(`${target}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw describeNetworkError(target, cause);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
    if (!response.ok) {
      const error = new Error(payload?.error || `O EduTerminal respondeu ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload ?? {};
  }

  async health(url) {
    const target = normalizeEduTerminalUrl(url);
    try {
      const response = await fetch(`${target}/health`, { headers: { accept: "application/json" } });
      if (!response.ok) return null;
      return await response.json();
    } catch (cause) {
      throw describeNetworkError(target, cause);
    }
  }

  async requestPairing({ url, code, name }) {
    return this.request(
      "POST",
      "/api/eduterminal/pair/request",
      { code: String(code || "").replace(/\D/g, ""), name: name || "VSX" },
      { url, token: "" },
    );
  }

  async pairingStatus({ url, requestId }) {
    return this.request(
      "GET",
      `/api/eduterminal/pair/status?requestId=${encodeURIComponent(requestId)}`,
      undefined,
      { url, token: "" },
    );
  }

  /**
   * Aguarda a autorização no EduTerminal.
   * `onStatus` recebe "pending" a cada consulta para a interface atualizar.
   */
  async waitForApproval({ url, requestId, timeout = 180_000, interval = 1500, onStatus } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const status = await this.pairingStatus({ url, requestId });
      onStatus?.(status.status);
      if (status.status === "approved" && status.token) {
        return status;
      }
      if (status.status === "denied") {
        throw new Error("A conexão foi recusada no EduTerminal.");
      }
      if (status.status === "expired") {
        throw new Error("O pedido de pareamento expirou. Gere um novo código no EduTerminal.");
      }
      if (Date.now() >= deadline) {
        throw new Error("Tempo esgotado esperando a autorização no EduTerminal.");
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  async verify({ url, token }) {
    const target = normalizeEduTerminalUrl(url);
    let response;
    try {
      response = await fetch(`${target}/api/bridge/info`, {
        headers: {
          accept: "application/json",
          "x-vsx-secret": token || "",
        },
      });
    } catch (cause) {
      throw describeNetworkError(target, cause);
    }
    if (response.status === 401) return { requiresSecret: true, url: target };
    if (!response.ok) return null;
    const info = await response.json();
    if (info.name !== "vsx-bridge") return null;
    return { ...info, requiresSecret: false, url: target };
  }

  async connect({ url, token, name }) {
    const info = await this.verify({ url, token });
    if (!info) {
      throw new Error(
        `Não foi possível confirmar o EduTerminal em ${normalizeEduTerminalUrl(url)}. ` +
          "Confira o endereço e se o servidor está iniciado.",
      );
    }
    if (info.requiresSecret) {
      throw new Error("O EduTerminal recusou o token de pareamento.");
    }
    this.save({ url, token, name });
    return info;
  }

  async status() {
    return this.request("GET", "/api/eduterminal/status");
  }

  async tools() {
    const { tools } = await this.request("GET", "/api/eduterminal/tools");
    return tools || [];
  }

  async installTool(id) {
    return this.request("POST", "/api/eduterminal/tools/install", { id });
  }

  async sessions() {
    const { sessions } = await this.request("GET", "/api/eduterminal/sessions");
    return sessions || [];
  }

  async openTerminal({ name, cols = 80, rows = 24 } = {}) {
    const protocol = this.url.startsWith("https:") ? "wss" : "ws";
    const host = this.url.replace(/^https?:\/\//, "");
    const socket = new WebSocket(`${protocol}://${host}/ws`);
    return new Promise((resolve, reject) => {
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token: this.token }));
      }, { once: true });
      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "auth.ok") {
          socket.send(JSON.stringify({ type: "session.create", name, cols, rows }));
        } else if (message.type === "auth.error") {
          reject(new Error(message.error));
        } else if (message.type === "session.created") {
          resolve({ socket, session: message.session });
        }
      });
      socket.addEventListener("error", () => reject(new Error("Falha no WebSocket do EduTerminal")));
    });
  }
}

export const eduterminal = new EduTerminalClient();
