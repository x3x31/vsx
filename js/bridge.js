const DEFAULT_BRIDGE = "http://127.0.0.1:4173";

/**
 * Endereços tentados na descoberta automática da ponte.
 *
 * Uma página no GitHub Pages não consegue alcançar 127.0.0.1 (o Chrome
 * bloqueia), mas a ponte costuma estar na mesma máquina ou no mesmo
 * Codespace — daí a URL pública no formato <porta>-app.github.dev.
 */
const DISCOVERY_URLS = [
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "https://4173-app.github.dev",
];

/**
 * Cliente da ponte local (servidor Node do vsx).
 * A ponte hospeda o processo `opencode serve` e o espelho git do repositório.
 */
export class BridgeClient {
  constructor(url = null) {
    this.url = (url || localStorage.getItem("vsx.bridge") || DEFAULT_BRIDGE).replace(/\/$/, "");
    this.secret = localStorage.getItem("vsx.bridge.secret") || "";
    this.online = false;
    this.tried = [];
    this.token = () => null;
  }

  setUrl(url) {
    this.url = url.replace(/\/$/, "");
    localStorage.setItem("vsx.bridge", this.url);
  }

  setSecret(secret) {
    this.secret = secret || "";
    localStorage.setItem("vsx.bridge.secret", this.secret);
  }

  /** Tenta vários endereços e fica com o primeiro que responder. */
  async discover(timeout = 3000) {
    // o endereço atual vem primeiro: no uso comum ele já funciona
    const current = await this.pingAt(this.url, timeout);
    if (current) {
      this.tried = [this.url];
      this.online = true;
      return current;
    }

    const others = [...new Set(DISCOVERY_URLS.filter((url) => url !== this.url))];
    this.tried = [this.url, ...others];

    const results = await Promise.all(
      others.map(async (url) => {
        const info = await this.pingAt(url, timeout);
        return info ? { url, info } : null;
      }),
    );

    const found = results.find(Boolean);
    if (found) {
      this.setUrl(found.url);
      this.online = true;
      return found.info;
    }

    this.online = false;
    return null;
  }

  async pingAt(url, timeout = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers = { accept: "application/json" };
    if (this.secret) headers["x-vsx-secret"] = this.secret;
    try {
      const res = await fetch(`${url}/api/bridge/info`, {
        signal: controller.signal,
        headers,
      });
      if (res.status === 401) {
        // a ponte respondeu, mas exige a senha
        this.secretRequiredAt = url;
        this.lastError = "A ponte exige a senha e a informada não confere.";
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Verifica se a ponte está de pé (com timeout curto). */
  async ping(timeout = 2500) {
    this.lastError = null;
    const info = await this.pingAt(this.url, timeout);
    this.online = Boolean(info);
    if (!info && !this.lastError) {
      this.lastError = "Não foi possível contatar a ponte.";
    }
    return info;
  }

  /* -------------------------------------------------------- opencode */

  async request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const token = this.token?.();
    if (token) headers["x-vsx-token"] = token;
    if (this.secret) headers["x-vsx-secret"] = this.secret;

    const res = await fetch(`${this.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
    if (!res.ok) {
      const error = new Error(payload?.error || `A ponte respondeu ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return payload ?? {};
  }

  status() {
    return this.request("GET", "/api/opencode/status");
  }

  session() {
    return this.request("GET", "/api/opencode/session");
  }

  newSession(agent, model) {
    return this.request("POST", "/api/opencode/session/new", { agent, model });
  }

  prompt(text, files) {
    return this.request("POST", "/api/opencode/prompt", { text, files });
  }

  interrupt() {
    return this.request("POST", "/api/opencode/interrupt", {});
  }

  permissions() {
    return this.request("GET", "/api/opencode/permission");
  }

  replyPermission(requestID, decision, message) {
    return this.request("POST", "/api/opencode/permission", { requestID, decision, message });
  }

  messages() {
    return this.request("GET", "/api/opencode/messages");
  }

  setModel(model) {
    return this.request("POST", "/api/opencode/model", { model });
  }

  setAgent(agent) {
    return this.request("POST", "/api/opencode/agent", { agent });
  }

  /** Garante que o repositório esteja espelhado localmente (necessário para o agente). */
  prepareWorkspace(repo, branch) {
    return this.request("POST", "/api/workspace/open", { repo, branch });
  }

  workspaceStatus() {
    return this.request("GET", "/api/workspace/status");
  }

  /** Stream de eventos do OpenCode. */
  events() {
    const query = this.secret ? `?secret=${encodeURIComponent(this.secret)}` : "";
    return new EventSource(`${this.url}/api/stream${query}`);
  }
}
