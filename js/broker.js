/**
 * Cliente do broker: o ponto que troca o `code` da autorização por um token.
 *
 * O navegador não pode fazer essa troca sozinho — `github.com/login/**` não
 * tem CORS (ESPECIFICACAO.md §2.1). Quem troca é o broker (broker/) ou, se
 * estiver por perto, a ponte local (`POST /oauth/exchange`): as duas rotas
 * têm o mesmo contrato e devolvem `{ token, scope }`.
 *
 * O token resultante fica no navegador de quem autorizou (localStorage), que
 * é também quem o envia de volta à ponte no header `x-vsx-token` quando o
 * terminal OpenCode estiver em uso.
 */

/** Endereço do broker publicado — cole aqui depois do deploy (broker/README.md). */
export const DEFAULT_BROKER_URL = "https://vsx.x3x31.workers.dev";

export class BrokerClient {
  constructor(url = null) {
    const saved = localStorage.getItem("vsx.broker");
    this.url = (url ?? saved ?? DEFAULT_BROKER_URL).replace(/\/+$/, "");
    this.lastError = null;
  }

  setUrl(url) {
    const clean = (url || "").replace(/\/+$/, "");
    this.url = clean || DEFAULT_BROKER_URL;
    if (clean) localStorage.setItem("vsx.broker", clean);
    else localStorage.removeItem("vsx.broker");
  }

  get configured() {
    return Boolean(this.url);
  }

  /** `GET /oauth/config` — o broker pode entregar o Client ID do vsx pronto. */
  async info(timeout = 6000) {
    if (!this.url) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${this.url}/oauth/config`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`o broker respondeu ${res.status}`);
      const data = await res.json();
      if (data.name && data.name !== "vsx-broker") {
        throw new Error("o endereço não é um broker do vsx");
      }
      this.lastError = null;
      return data;
    } catch (err) {
      this.lastError = err.name === "AbortError" ? "o broker não respondeu" : err.message;
      throw new Error(this.lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  /** `POST /oauth/exchange` — troca o código por token e devolve para o navegador. */
  async exchange(payload, timeout = 20000) {
    if (!this.url) throw new Error("broker não configurado");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${this.url}/oauth/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text };
      }

      if (!res.ok) throw new Error(data?.error || `o broker respondeu ${res.status}`);
      if (!data.token) throw new Error(data?.error || "o broker não devolveu um token");
      return data;
    } catch (err) {
      throw new Error(
        err.name === "AbortError" ? "o broker demorou demais para responder" : err.message,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
