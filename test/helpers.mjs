/**
 * Servidores de apoio dos testes: o GitHub simulado, o broker (worker real
 * rodando em Node), o site estático (o que o GitHub Pages publicaria) e a
 * ponte local.
 *
 * Nada aqui fala com a rede externa — o objetivo é exercitar o fluxo inteiro
 * do vsx sem depender do GitHub de verdade.
 */
import http from "node:http";
import os from "node:os";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** Porta livre (evita colidir com o PORT do ambiente). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** GitHub simulado: troca de código por token, /user e /user/repos. */
export async function startMockGithub({ validCode = "TESTCODE", token = "gho_broker_token" } = {}) {
  const state = { tokenRequests: [], userRequests: 0 };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
      const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
      state.tokenRequests.push(body);
      if (body.code !== validCode) {
        json(res, 200, { error: "bad_verification_code", error_description: "código inválido" });
        return;
      }
      json(res, 200, { access_token: token, scope: "repo", token_type: "bearer" });
      return;
    }

    if (url.pathname === "/user") {
      state.userRequests += 1;
      json(res, 200, { login: "alice", name: "Alice", avatar_url: "https://example.com/a.png" });
      return;
    }

    if (url.pathname === "/user/repos") {
      json(res, 200, []);
      return;
    }

    json(res, 404, { message: "Not Found" });
  });

  const port = await listen(server);
  return {
    state,
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    tokenUrl: `http://127.0.0.1:${port}/login/oauth/access_token`,
    userUrl: `http://127.0.0.1:${port}/user`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Serve os arquivos do repositório (index.html, js/, css/, vendor/) — é o
 * que o GitHub Pages publica, em uma origem diferente da ponte e do broker.
 */
export async function startStaticServer(root = ROOT) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let relative = decodeURIComponent(url.pathname);
    if (relative === "/" || relative === "") relative = "/index.html";

    const target = path.join(root, path.normalize(relative).replace(/^(\.\.[/\\])+/, ""));
    if (!target.startsWith(root)) {
      res.writeHead(403).end("Proibido");
      return;
    }
    try {
      const data = await fsp.readFile(target);
      res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("Nao encontrado");
    }
  });

  const port = await listen(server);
  return { server, port, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/**
 * O broker de verdade (broker/worker.js) servido por Node: mesmo código que
 * vai para o Cloudflare, mesmas rotas, mesmo CORS.
 */
export async function startBroker({ github, clientId = "Iv1.teste", allowedOrigins = "http://127.0.0.1:5173" }) {
  const worker = (await import(path.join(ROOT, "broker", "worker.js"))).default;
  const env = {
    VSX_CLIENT_ID: clientId,
    VSX_ALLOWED_ORIGINS: allowedOrigins,
    VSX_GITHUB_TOKEN_URL: github.tokenUrl,
    VSX_GITHUB_USER_URL: github.userUrl,
  };

  const server = http.createServer(async (req, res) => {
    try {
      const headers = {};
      if (req.headers.origin) headers.origin = req.headers.origin;
      if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];

      const request = new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req),
      });

      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  const port = await listen(server);
  return {
    server,
    port,
    clientId,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** A ponte (server/index.js) de verdade, com HOME isolado e GitHub simulado. */
export async function startBridge({ github, clientId = "Iv1.ponte", env = {}, secret = "" } = {}) {
  const port = await freePort();
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "vsx-home-"));

  const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PORT: String(port),
      HOST: "127.0.0.1",
      VSX_OPEN_BROWSER: "0",
      GITHUB_OAUTH_CLIENT_ID: clientId,
      GITHUB_OAUTH_TOKEN_URL: github.tokenUrl,
      GITHUB_API_URL: github.url,
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
      // o runner pode estar dentro de um Codespace; cada teste decide o ambiente
      CODESPACES: "",
      CODESPACE_NAME: "",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "",
      VSX_PUBLIC_URL: "",
      CORS_ORIGINS: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const append = (chunk) => {
    output += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  const url = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ponte nao subiu:\n${output}`)), 8000);
    const poll = setInterval(async () => {
      if (!output.includes("vsx rodando em")) return;
      try {
        const headers = secret ? { "x-vsx-secret": secret } : {};
        const res = await fetch(`${url}/api/bridge/info`, { headers });
        if (res.ok) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      } catch {
        /* ainda subindo */
      }
    }, 120);
    child.once("exit", (code) => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error(`ponte saiu com ${code}:\n${output}`));
    });
  });

  return {
    child,
    url,
    home,
    port,
    output: () => output,
    stop: () =>
      new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill("SIGTERM");
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2000).unref();
      }),
  };
}
