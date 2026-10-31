import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function list(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Configuração do connector do EduTerminal.
 *
 * Tudo pode ser alterado por variável de ambiente para que o mesmo código
 * rode no Termux, no desktop (testes) e dentro do APK companheiro.
 */
export const config = {
  version: "0.1.0",
  port: number(process.env.EDUTERMINAL_PORT, 8765),
  host: process.env.EDUTERMINAL_HOST || "0.0.0.0",

  home: HOME,
  configDir:
    process.env.EDUTERMINAL_CONFIG_DIR || path.join(HOME, ".config", "eduterminal"),
  workspaceDir:
    process.env.EDUTERMINAL_WORKSPACE_DIR ||
    path.join(HOME, ".local", "share", "eduterminal", "workspaces"),

  pairingTtlMs: number(process.env.EDUTERMINAL_PAIRING_TTL, 120_000),
  tokenTtlMs: number(process.env.EDUTERMINAL_TOKEN_TTL, 8 * 60 * 60 * 1000),
  requestTtlMs: number(process.env.EDUTERMINAL_REQUEST_TTL, 10 * 60 * 1000),
  maxSessions: number(process.env.EDUTERMINAL_MAX_SESSIONS, 4),

  autoApprove:
    process.env.EDUTERMINAL_AUTO_APPROVE === "1" ||
    process.argv.includes("--auto-approve"),

  adminToken: process.env.EDUTERMINAL_ADMIN_TOKEN || null,

  shell:
    process.env.EDUTERMINAL_SHELL ||
    (process.platform === "win32" ? "powershell.exe" : "bash"),
  shellArgs: list(
    process.env.EDUTERMINAL_SHELL_ARGS,
    process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-Command", "-"]
      : ["-i"],
  ),

  opencodeBin: process.env.EDUTERMINAL_OPENCODE || "opencode",
  opencodeArgs: list(process.env.EDUTERMINAL_OPENCODE_ARGS, ["serve"]),

  tlsKey: process.env.EDUTERMINAL_TLS_KEY || null,
  tlsCert: process.env.EDUTERMINAL_TLS_CERT || null,

  /**
   * Origens autorizadas a falar com o connector a partir do navegador.
   * O VSX oficial fica em x3x31.github.io; qualquer subdomínio github.io é
   * aceito para forks do VSX. `*` casa com um trecho do host.
   */
  allowedOrigins: list(process.env.EDUTERMINAL_ALLOWED_ORIGINS, [
    "https://x3x31.github.io",
    "https://*.github.io",
    "http://localhost",
    "http://127.0.0.1",
  ]),

  maxBodyBytes: number(process.env.EDUTERMINAL_MAX_BODY, 2 * 1024 * 1024),
};

export function pairingFile(cfg = config) {
  return path.join(cfg.configDir, "pairing.json");
}

export function stateFile(cfg = config) {
  return path.join(cfg.configDir, "state.json");
}
