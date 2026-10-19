const DEVICE_CODE_URL = process.env.GITHUB_OAUTH_DEVICE_URL || "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = process.env.GITHUB_OAUTH_TOKEN_URL || "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * Fluxo de autorização do GitHub (OAuth device flow).
 *
 * O navegador não pode falar com github.com diretamente (CORS), então quem
 * faz as chamadas é a ponte. O device flow não exige client_secret: apenas o
 * client_id do OAuth App, que é público.
 */
export class OAuth {
  constructor({ clientId = null } = {}) {
    this.clientId = clientId;
    this.sessions = new Map();
  }

  get configured() {
    return Boolean(this.clientId);
  }

  /** Guarda o client_id usado em cada pedido, para trocar o código com segurança. */
  #remember(deviceCode, clientId) {
    this.sessions.set(deviceCode, clientId);
    if (this.sessions.size > 20) {
      this.sessions.delete(this.sessions.keys().next().value);
    }
  }

  async #post(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("Resposta inesperada do GitHub");
    }
    return data;
  }

  /** Inicia o pedido de autorização e devolve o código para o usuário digitar. */
  async start({ clientId, scope = "repo" } = {}) {
    const id = (clientId || this.clientId || "").trim();
    if (!id) {
      const error = new Error(
        "Informe o Client ID do OAuth App do vsx (crie um em https://github.com/settings/developers).",
      );
      error.status = 400;
      throw error;
    }

    const data = await this.#post(DEVICE_CODE_URL, { client_id: id, scope });
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    this.#remember(data.device_code, id);

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in || 900,
      interval: data.interval || 5,
    };
  }

  /** Consulta o estado do pedido; o token aparece quando o usuário autoriza. */
  async poll(deviceCode) {
    if (!deviceCode) throw new Error("deviceCode ausente");

    const data = await this.#post(ACCESS_TOKEN_URL, {
      client_id: this.sessions.get(deviceCode) || this.clientId,
      device_code: deviceCode,
      grant_type: GRANT_TYPE,
    });

    if (data.error) {
      return {
        pending: data.error === "authorization_pending" || data.error === "slow_down",
        error: data.error,
        description: data.error_description,
      };
    }

    return {
      pending: false,
      token: data.access_token,
      tokenType: data.token_type,
      scope: data.scope,
    };
  }
}
