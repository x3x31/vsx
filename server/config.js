import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = os.homedir();
export const CONFIG_DIR = process.env.VSX_CONFIG_DIR || path.join(HOME, ".config", "vsx");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const WORKSPACE_DIR =
  process.env.VSX_WORKSPACE_DIR || path.join(HOME, ".local", "share", "vsx", "workspaces");

/**
 * Dados do GitHub Codespaces, quando a ponte roda dentro de um.
 *
 * O Codespaces publica a porta encaminhada em
 *   https://<CODESPACE_NAME>-<porta>.<GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN>
 * — e nao no formato antigo `https://<porta>-<dominio>`.
 */
export function codespaceInfo() {
  const name = process.env.CODESPACE_NAME || "";
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "";
  const detected = process.env.CODESPACES === "true" || Boolean(name && domain);
  return { detected, name, domain };
}

/**
 * URL publica da ponte, ou `null` quando ela so existe no loopback.
 * `VSX_PUBLIC_URL` tem prioridade (tunel proprio, proxy, piloto).
 */
export function publicUrlFor(port = 4173) {
  const explicit = (process.env.VSX_PUBLIC_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const { name, domain } = codespaceInfo();
  if (!name || !domain) return null;
  return `https://${name}-${port}.${domain}`;
}

const DEFAULTS = {
  token: null,
  user: null,
  disabled: false,
  clientId: null,
  bridgeSecret: null,
  lastRepo: null,
  lastBranch: null,
  model: null,
  agent: null,
};

function ensureDirs() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

export function loadConfig() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(patch) {
  const current = loadConfig();
  const next = { ...current, ...patch };
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

/** Token vindo do ambiente tem prioridade sobre o salvo, e o que o usuario digita tem prioridade sobre tudo. */
export function resolveToken(config) {
  if (config.disabled) return null;
  return config.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}
