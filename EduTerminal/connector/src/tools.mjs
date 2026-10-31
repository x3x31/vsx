import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export class ToolsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ToolsError";
    this.status = status;
  }
}

const TOOLS = [
  { id: "node", name: "Node.js", bin: "node", pkg: "nodejs", apt: "nodejs", versionArgs: ["--version"] },
  { id: "npm", name: "npm", bin: "npm", pkg: "nodejs", apt: "npm", versionArgs: ["--version"] },
  { id: "git", name: "Git", bin: "git", pkg: "git", apt: "git", versionArgs: ["--version"] },
  { id: "python", name: "Python", bin: "python", pkg: "python", apt: "python3", versionArgs: ["--version"] },
  { id: "nano", name: "Nano", bin: "nano", pkg: "nano", apt: "nano", versionArgs: ["--version"] },
  { id: "vim", name: "Vim", bin: "vim", pkg: "vim", apt: "vim", versionArgs: ["--version"] },
  {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    pkg: null,
    apt: null,
    versionArgs: ["--version"],
    npm: "opencode-ai",
  },
];

function quote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function commandExists(command) {
  if (process.platform === "win32") {
    try {
      await exec("where", [command], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
  try {
    await exec("sh", ["-c", `command -v ${quote(command)}`], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function firstLine(command, args) {
  try {
    const { stdout, stderr } = await exec(command, args, { timeout: 15_000 });
    return String(stdout || stderr || "").split("\n")[0].trim();
  } catch {
    return null;
  }
}

async function hasCommand(command) {
  return commandExists(command);
}

/**
 * Gerenciador de ferramentas sob demanda.
 *
 * No Termux usa `pkg`; em Debian/Ubuntu usa `apt-get`; no Windows apenas
 * informa o que está instalado (a instalação automática é exclusiva do
 * ambiente Linux do EduTerminal).
 */
export class Tools {
  constructor({ extraTools = [] } = {}) {
    this.tools = [...TOOLS, ...extraTools];
  }

  async list() {
    const result = [];
    for (const tool of this.tools) {
      const installed = await commandExists(tool.bin);
      result.push({
        id: tool.id,
        name: tool.name,
        installed,
        version: installed ? await firstLine(tool.bin, tool.versionArgs) : null,
        package: tool.pkg || tool.npm || null,
      });
    }
    return result;
  }

  async install(id) {
    const tool = this.tools.find((item) => item.id === id);
    if (!tool) throw new ToolsError(`Ferramenta desconhecida: ${id}`, 404);
    if (await commandExists(tool.bin)) {
      return { id, installed: true, message: `${tool.name} já está instalado`, output: "" };
    }

    const termux = await hasCommand("pkg");
    const apt = !termux && (await hasCommand("apt-get"));
    const brew = !termux && !apt && (await hasCommand("brew"));

    let command;
    let args;
    if (termux && tool.pkg) {
      command = "pkg";
      args = ["install", "-y", tool.pkg];
    } else if (apt && tool.apt) {
      command = "apt-get";
      args = ["install", "-y", tool.apt];
    } else if (brew && tool.pkg) {
      command = "brew";
      args = ["install", tool.pkg];
    } else if (tool.npm && (await hasCommand("npm"))) {
      command = "npm";
      args = ["install", "-g", tool.npm];
    } else {
      throw new ToolsError(
        `Não há gerenciador de pacotes disponível para instalar ${tool.name}. ` +
          "No Termux, use: pkg install " + (tool.pkg || tool.npm || tool.id),
        501,
      );
    }

    try {
      const { stdout, stderr } = await exec(command, args, {
        timeout: 15 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      });
      return {
        id,
        installed: await commandExists(tool.bin),
        message: `${tool.name} instalado`,
        output: String(stdout || stderr || "").slice(-8000),
      };
    } catch (error) {
      throw new ToolsError(
        `Falha ao instalar ${tool.name}: ${(error.stderr || error.message || "").trim()}`,
        500,
      );
    }
  }
}
