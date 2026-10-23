#!/usr/bin/env node
/**
 * Sobe a ponte do vsx dentro de um GitHub Codespace.
 *
 * O Codespaces encaminha a porta 4173. A URL pública correta é
 *   https://<CODESPACE_NAME>-<PORT>.<GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN>
 * e não https://<PORT>-<DOMAIN>, que é o formato antigo impresso pelo servidor.
 *
 * Uso:
 *   node scripts/start-codespace.mjs            # sobe a ponte
 *   node scripts/start-codespace.mjs --print    # só mostra URL/senha e sai
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig } from "../server/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const CODESPACE_NAME = process.env.CODESPACE_NAME || "";
const FORWARDING_DOMAIN = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "";
const PUBLIC_URL =
  CODESPACE_NAME && FORWARDING_DOMAIN
    ? `https://${CODESPACE_NAME}-${PORT}.${FORWARDING_DOMAIN}`
    : null;
const PRINT_ONLY = process.argv.includes("--print");

function resolveBridgeSecret() {
  if (process.env.BRIDGE_SECRET) return process.env.BRIDGE_SECRET;
  const config = loadConfig();
  if (config.bridgeSecret) return config.bridgeSecret;
  return saveConfig({ bridgeSecret: randomBytes(24).toString("hex") }).bridgeSecret;
}

const secret = resolveBridgeSecret();

if (PRINT_ONLY) {
  console.log(
    JSON.stringify(
      {
        codespaces: Boolean(PUBLIC_URL),
        host: HOST,
        port: PORT,
        publicUrl: PUBLIC_URL,
        bridgeSecret: secret,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log("\n  vsx — GitHub Codespace");
console.log(`  porta:        ${PORT}`);
if (PUBLIC_URL) {
  console.log(`  URL pública:  ${PUBLIC_URL}`);
  console.log(`  torne a porta ${PORT} pública nas Ports do Codespaces se o Pages não conectar.`);
} else {
  console.log("  aviso: este processo não parece estar dentro de um Codespace.");
  console.log(`  URL local:    http://127.0.0.1:${PORT}`);
}
console.log(`  senha:        ${secret}`);
console.log("  pare com Ctrl+C ou mate o processo pelo PID em /tmp/vsx-codespace.pid");
console.log("");

const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  cwd: ROOT,
  env: {
    ...process.env,
    HOST,
    PORT: String(PORT),
    BRIDGE_SECRET: secret,
    VSX_OPEN_BROWSER: "0",
    ...(PUBLIC_URL ? { VSX_PUBLIC_URL: PUBLIC_URL } : {}),
  },
  stdio: "inherit",
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

child.on("error", (err) => {
  console.error(`  falha ao iniciar a ponte: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code) => {
  process.exit(code ?? 0);
});
