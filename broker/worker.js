/**
 * Broker OAuth do vsx — Cloudflare Worker.
 *
 * Por que ele existe: `github.com/login/oauth/access_token` não envia cabeçalhos
 * CORS, então o navegador **não** troca o `code` pelo token sozinho (é a
 * restrição registrada em ESPECIFICACAO.md §2.1). Este worker faz exatamente
 * essa troca — e nada mais:
 *
 *   - stateless: não grava token de ninguém (era o item 4 do "em aberto" da
 *     especificação: um broker não pode guardar credencial de terceiros);
 *   - o token devolvido vai para o navegador de quem autorizou, que passa a
 *     guardá-lo no localStorage, como o VS Code guarda a credencial da conta;
 *   - PKCE: o `code_verifier` vem do navegador, então o código só troca na
 *     janela que iniciou a autorização;
 *   - o `client_secret` (se o seu OAuth App exigir) fica só aqui, nunca no
 *     navegador — defina com `wrangler secret put VSX_CLIENT_SECRET`.
 *
 * Deploy: veja broker/README.md.
 */

const DEFAULT_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEFAULT_USER_URL = "https://api.github.com/user";
/** Origens que podem usar o broker (troque em wrangler.toml se precisar). */
const DEFAULT_ORIGINS = "https://x3x31.github.io";

function allowlist(env) {
  return String(env.VSX_ALLOWED_ORIGINS || DEFAULT_ORIGINS)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Cabeçalhos CORS da resposta, ou `null` se a origem não está autorizada.
 * Sem `Origin` (curl, worker-to-worker) segue sem CORS — o navegador é que
 * precisa da permissão.
 */
function corsHeaders(origin, env) {
  if (!origin) return {};
  const list = allowlist(env);
  const wildcard =
    list.includes("*.github.io") && /^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin);
  if (!list.includes(origin) && !wildcard) return null;
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** POST form-encoded (o formato que o GitHub documenta) com resposta JSON. */
async function post(url, fields) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": "vsx-broker",
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // GitHub devolve form-encoded quando não lê o Accept: application/json
    return Object.fromEntries(new URLSearchParams(text));
  }
}

/** Identidade de quem autorizou, para a página mostrar o login sem chamada extra. */
async function loginOf(token, env) {
  try {
    const res = await fetch(env.VSX_GITHUB_USER_URL || DEFAULT_USER_URL, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "vsx-broker",
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user.login || null;
  } catch {
    return null;
  }
}

/** Troca o código da autorização por um token. É a única coisa que o broker faz. */
async function exchange(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Corpo da requisicao invalido" }, 400, cors);

  const { code, clientId, redirectUri, verifier } = body;
  if (!code) return json({ error: "Codigo de autorizacao ausente" }, 400, cors);

  const client_id = String(clientId || env.VSX_CLIENT_ID || "").trim();
  if (!client_id) {
    return json(
      { error: "Broker sem VSX_CLIENT_ID — configure em broker/wrangler.toml (veja broker/README.md)" },
      400,
      cors,
    );
  }

  const data = await post(env.VSX_GITHUB_TOKEN_URL || DEFAULT_TOKEN_URL, {
    client_id,
    client_secret: env.VSX_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  if (data.error || !data.access_token) {
    return json(
      {
        error:
          data.error_description ||
          data.error ||
          "O GitHub não devolveu um token",
        code: data.error || "exchange_failed",
      },
      400,
      cors,
    );
  }

  return json(
    {
      token: data.access_token,
      scope: data.scope,
      tokenType: data.token_type,
      login: await loginOf(data.access_token, env),
    },
    200,
    cors,
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get("origin"), env);

    if (cors === null) {
      return json({ error: "Origem nao autorizada a usar o broker" }, 403, {
        "access-control-allow-origin": "",
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const route = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "GET" && ["/", "/oauth/config", "/api/oauth/config"].includes(route)) {
      return json({ name: "vsx-broker", clientId: env.VSX_CLIENT_ID || "" }, 200, cors);
    }

    if (request.method === "POST" && ["/oauth/exchange", "/api/oauth/exchange"].includes(route)) {
      try {
        return await exchange(request, env, cors);
      } catch (err) {
        return json({ error: err.message || "Falha ao falar com o GitHub" }, 502, cors);
      }
    }

    return json({ error: "Rota nao encontrada" }, 404, cors);
  },
};
