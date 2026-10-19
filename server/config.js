import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = os.homedir();
export const CONFIG_DIR = path.join(HOME, ".config", "vsx");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const WORKSPACE_DIR = path.join(HOME, ".local", "share", "vsx", "workspaces");

const DEFAULTS = {
  token: null,
  user: null,
  disabled: false,
  clientId: null,
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
