import { BridgeClient } from "./bridge.js";
import { BrokerClient } from "./broker.js";
import { GithubClient } from "./github.js";
import { Workspace } from "./workspace.js";

const TOKEN_KEY = "vsx.token";
const CODESPACE_KEY = "vsx.codespace";

export const github = new GithubClient(localStorage.getItem(TOKEN_KEY));
export const bridge = new BridgeClient();
export const broker = new BrokerClient();
export const workspace = new Workspace({ github, bridge });

bridge.token = () => getToken();

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  github.setToken(token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  github.setToken(null);
}

/** Conecta ao GitHub e valida o token. */
export async function connect(token) {
  github.setToken(token);
  const user = await github.getUser();
  setToken(token);
  return user;
}

export function loadCodespace() {
  try {
    return JSON.parse(localStorage.getItem(CODESPACE_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveCodespace(config) {
  if (!config) {
    localStorage.removeItem(CODESPACE_KEY);
    return null;
  }
  localStorage.setItem(CODESPACE_KEY, JSON.stringify(config));
  return config;
}
