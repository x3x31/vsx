import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config as defaultConfig } from "./config.mjs";

const exec = promisify(execFile);

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "echo",
  LC_ALL: "C",
};

function authHeader(token) {
  if (!token) return null;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return `Authorization: Basic ${basic}`;
}

async function git(args, { cwd, token, allowFail = false } = {}) {
  const full = ["-c", "core.quotepath=false"];
  const header = authHeader(token);
  if (header) full.push("-c", `http.extraHeader=${header}`);
  full.push(...args);
  try {
    const { stdout, stderr } = await exec("git", full, {
      cwd,
      env: GIT_ENV,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    if (allowFail) {
      return { stdout: error.stdout || "", stderr: error.stderr || error.message, code: error.code ?? 1 };
    }
    const message = (error.stderr || error.message || "erro no git").trim();
    throw new Error(message);
  }
}

export class WorkspaceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "WorkspaceError";
    this.status = status;
  }
}

export function workspacePath(fullName, cfg = defaultConfig) {
  const [owner, repo] = String(fullName).split("/");
  if (!owner || !repo) throw new WorkspaceError("Repositório inválido");
  return path.join(cfg.workspaceDir, owner, repo);
}

/** Resolve um caminho relativo garantindo que ele fique dentro do workspace. */
export function safeJoin(root, relative = "") {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative || ".");
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new WorkspaceError("Caminho fora do repositório", 403);
  }
  return target;
}

export async function isWorkspace(root) {
  try {
    await fs.access(path.join(root, ".git"));
    return true;
  } catch {
    return false;
  }
}

export async function openLocal(root) {
  const resolved = path.resolve(root);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new WorkspaceError(`Pasta não encontrada: ${resolved}`, 404);
  }
  return { path: resolved, cloned: false, updated: false, local: true };
}

export async function openWorkspace({ fullName, branch, token, cfg = defaultConfig }) {
  const root = workspacePath(fullName, cfg);
  const exists = await isWorkspace(root);

  if (!exists) {
    await fs.mkdir(path.dirname(root), { recursive: true });
    const url = `https://github.com/${fullName}.git`;
    const args = ["clone", "--depth", "50", "--no-tags"];
    if (branch) args.push("--branch", branch);
    args.push(url, root);
    const result = await git(args, { cwd: path.dirname(root), token, allowFail: true });
    if (result.code !== 0) {
      await fs.rm(root, { recursive: true, force: true });
      throw new WorkspaceError(`Falha ao clonar ${fullName}: ${result.stderr.trim()}`);
    }
    await git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], { cwd: root });
    return { path: root, cloned: true, updated: true };
  }

  const current = (await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root })).stdout.trim();
  const target = branch || current;

  if (target !== current) {
    const checkout = await checkoutBranch(root, target, token);
    if (checkout.code !== 0) {
      throw new WorkspaceError(`Branch ${target} não encontrado: ${checkout.stderr.trim()}`);
    }
  }

  const pull = await git(["pull", "--ff-only", "origin", target], { cwd: root, token, allowFail: true });
  return {
    path: root,
    cloned: false,
    updated: pull.code === 0,
    pullMessage: pull.code === 0 ? null : pull.stderr.trim(),
  };
}

async function checkoutBranch(root, target, token) {
  await git(["fetch", "--depth", "50", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"], {
    cwd: root,
    token,
    allowFail: true,
  });

  const local = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${target}`], {
    cwd: root,
    allowFail: true,
  });
  if (local.code === 0) {
    return git(["checkout", target], { cwd: root, allowFail: true });
  }
  return git(["checkout", "-b", target, `origin/${target}`], { cwd: root, allowFail: true });
}

async function walkFiles(root, relative = "", output = []) {
  const dir = path.join(root, relative);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkFiles(root, child, output);
    } else if (entry.isFile()) {
      output.push(child);
      if (output.length > 10_000) return output;
    }
  }
  return output;
}

/** Lista arquivos versionados/ignorados; fora do git, percorre a pasta. */
export async function listFiles(root) {
  if (!(await isWorkspace(root))) {
    const files = await walkFiles(root);
    return files.map((file) => ({ path: file, tracked: false }));
  }
  const result = await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    allowFail: true,
  });
  if (result.code !== 0) {
    const files = await walkFiles(root);
    return files.map((file) => ({ path: file, tracked: false }));
  }
  const files = result.stdout.split("\0").filter(Boolean);
  const tracked = new Set(
    (await git(["ls-files", "--cached", "-z"], { cwd: root, allowFail: true })).stdout
      .split("\0")
      .filter(Boolean),
  );
  return files.map((file) => ({ path: file, tracked: tracked.has(file) }));
}

export async function readFile(root, relative) {
  const target = safeJoin(root, relative);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat || !stat.isFile()) throw new WorkspaceError("Arquivo não encontrado", 404);

  if (stat.size > 5 * 1024 * 1024) {
    throw new WorkspaceError("Arquivo muito grande para o editor", 413);
  }

  const buffer = await fs.readFile(target);
  const isBinary = buffer.subarray(0, 8000).includes(0);
  if (isBinary) {
    return { binary: true, content: "", size: stat.size, mtime: stat.mtimeMs, path: relative };
  }
  return {
    binary: false,
    content: buffer.toString("utf8"),
    size: stat.size,
    mtime: stat.mtimeMs,
    path: relative,
  };
}

export async function writeFile(root, relative, content) {
  const target = safeJoin(root, relative);
  if (target.includes(`${path.sep}.git${path.sep}`) || target.endsWith(`${path.sep}.git`)) {
    throw new WorkspaceError("Não é possível escrever dentro de .git", 403);
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content ?? "", "utf8");
  const stat = await fs.stat(target);
  return { path: relative, size: stat.size, mtime: stat.mtimeMs };
}

export async function removeFile(root, relative) {
  const target = safeJoin(root, relative);
  await fs.rm(target, { force: true, recursive: false });
  return { path: relative };
}

export async function createFile(root, relative, content = "") {
  const target = safeJoin(root, relative);
  const exists = await fs.stat(target).catch(() => null);
  if (exists) throw new WorkspaceError("O arquivo já existe", 409);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return { path: relative };
}

export async function gitStatus(root) {
  if (!(await isWorkspace(root))) return [];
  const result = await git(["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    allowFail: true,
  });
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const index = line[0];
      const worktree = line[1];
      const file = line.slice(3).trim();
      let status = "modified";
      if (index === "?" && worktree === "?") status = "untracked";
      else if (index === "A" || worktree === "A") status = "added";
      else if (index === "D" || worktree === "D") status = "deleted";
      else if (index === "R" || worktree === "R") status = "renamed";
      return { path: file, status, staged: index !== " " && index !== "?" };
    });
}

export async function currentBranch(root) {
  if (!(await isWorkspace(root))) return null;
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, allowFail: true });
  return result.stdout.trim() || null;
}

export async function localBranches(root) {
  if (!(await isWorkspace(root))) return [];
  const result = await git(["branch", "--format=%(refname:short)"], { cwd: root, allowFail: true });
  return result.stdout.split("\n").map((branch) => branch.trim()).filter(Boolean);
}

export async function diffFile(root, relative) {
  if (!(await isWorkspace(root))) return { unstaged: "", staged: "" };
  const unstaged = await git(["diff", "--", relative], { cwd: root, allowFail: true });
  const staged = await git(["diff", "--cached", "--", relative], { cwd: root, allowFail: true });
  return { unstaged: unstaged.stdout, staged: staged.stdout };
}

export async function commitAndPush(root, { message, branch, token }) {
  if (!(await isWorkspace(root))) {
    throw new WorkspaceError("Esta pasta não é um repositório git");
  }
  const status = await gitStatus(root);
  if (!status.length) throw new WorkspaceError("Não há alterações para commitar");

  const add = await git(["add", "-A"], { cwd: root, allowFail: true });
  if (add.code !== 0) throw new WorkspaceError(add.stderr.trim() || "Falha ao preparar alterações");

  const commit = await git(
    ["commit", "-m", message || "Atualizações via VSX/EduTerminal"],
    { cwd: root, allowFail: true },
  );
  if (commit.code !== 0) throw new WorkspaceError(commit.stderr.trim() || "Falha ao criar commit");

  const target = branch || (await currentBranch(root));
  const push = await git(["push", "origin", target], { cwd: root, token, allowFail: true });
  if (push.code !== 0) {
    throw new WorkspaceError(`Commit criado localmente, mas o push falhou: ${push.stderr.trim()}`);
  }

  const head = (await git(["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim();
  return { sha: head, branch: target, pushed: true };
}

export async function discardChanges(root, relative) {
  if (!(await isWorkspace(root))) {
    if (relative) await fs.rm(safeJoin(root, relative), { force: true });
    return { ok: true };
  }
  if (relative) {
    const result = await git(["checkout", "--", relative], { cwd: root, allowFail: true });
    if (result.code !== 0) {
      await fs.rm(safeJoin(root, relative), { force: true });
    }
  } else {
    await git(["reset", "--hard"], { cwd: root, allowFail: true });
    await git(["clean", "-fd"], { cwd: root, allowFail: true });
  }
  return { ok: true };
}
