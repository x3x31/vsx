import { BridgeClient } from "./bridge.js";
import { GithubClient } from "./github.js";
import { Workspace } from "./workspace.js";

const TOKEN_KEY = "vsx.token";

export const github = new GithubClient(localStorage.getItem(TOKEN_KEY));
export const bridge = new BridgeClient();
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
