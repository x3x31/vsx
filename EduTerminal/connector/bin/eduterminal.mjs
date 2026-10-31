#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { config } from "../src/config.mjs";
import { createEduTerminalServer } from "../src/server.mjs";
import { lanAddresses, log } from "../src/util.mjs";

function parseArgs(argv) {
  const options = { pair: true, workspace: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-pair") options.pair = false;
    else if (arg === "--auto-approve") options.autoApprove = true;
    else if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--host") options.host = argv[++i];
    else if (arg === "--workspace") options.workspace = argv[++i];
    else if (arg === "--tls-key") options.tlsKey = argv[++i];
    else if (arg === "--tls-cert") options.tlsCert = argv[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

function help() {
  console.log(`EduTerminal connector

Uso:
  eduterminal [start] [opções]

Opções:
  --port <porta>          porta do servidor (padrão: ${config.port})
  --host <endereço>       interface de escuta (padrão: ${config.host})
  --workspace <pasta>     pasta inicial para sessões e arquivos
  --no-pair               não gera código de pareamento ao iniciar
  --auto-approve          aprova automaticamente (somente desenvolvimento)
  --tls-key <arquivo>     chave TLS (habilita HTTPS/WSS)
  --tls-cert <arquivo>    certificado TLS
  --help                  mostra esta ajuda

Variáveis de ambiente principais:
  EDUTERMINAL_PORT, EDUTERMINAL_HOST, EDUTERMINAL_WORKSPACE_DIR,
  EDUTERMINAL_PAIRING_TTL, EDUTERMINAL_TOKEN_TTL, EDUTERMINAL_MAX_SESSIONS,
  EDUTERMINAL_ALLOWED_ORIGINS, EDUTERMINAL_OPENCODE
`);
}

function banner(server, pairingResult, options) {
  const port = server.actualPort();
  const scheme = server.config.tlsKey ? "https" : "http";
  const wsScheme = scheme === "https" ? "wss" : "ws";
  const addresses = lanAddresses();

  console.log("");
  console.log("  EduTerminal — ambiente Linux para o VSX");
  console.log("  ----------------------------------------");
  console.log(`  versão ....... ${server.config.version}`);
  console.log(`  escuta ....... ${server.config.host}:${port}`);
  console.log(`  workspace .... ${server.config.workspaceDir}`);
  console.log(`  OpenCode ..... ${server.config.opencodeBin}`);
  console.log("");
  console.log(`  local ........ ${scheme}://127.0.0.1:${port}`);
  for (const item of addresses) {
    console.log(`  rede ......... ${scheme}://${item.address}:${port}  (${item.name})`);
  }
  console.log("");
  console.log(`  WebSocket .... ${wsScheme}://127.0.0.1:${port}/ws`);
  console.log("");

  if (pairingResult?.code) {
    console.log("  CÓDIGO DE PAREAMENTO (mostre ao VSX)");
    console.log(`  >>> ${pairingResult.code} <<<`);
    console.log(`  válido por ${Math.round(server.config.pairingTtlMs / 1000)} segundos`);
    console.log("");
  } else if (options.pair === false) {
    console.log("  pareamento automático desligado (--no-pair)");
    console.log("");
  }

  console.log("  No VSX, informe o endereço e o token de pareamento.");
  console.log("  Em páginas HTTPS, o navegador pode bloquear http:// na rede local:");
  console.log("  use HTTPS/WSS com certificado, ou abra o VSX na mesma máquina.");
  console.log("  Pressione Ctrl+C para encerrar.");
  console.log("");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
    return;
  }

  const overrides = {};
  if (options.port) overrides.port = options.port;
  if (options.host) overrides.host = options.host;
  if (options.autoApprove) overrides.autoApprove = true;
  if (options.tlsKey) overrides.tlsKey = options.tlsKey;
  if (options.tlsCert) overrides.tlsCert = options.tlsCert;
  if (options.workspace) {
    overrides.workspaceDir = path.resolve(options.workspace);
  }

  fs.mkdirSync(overrides.workspaceDir || config.workspaceDir, { recursive: true });
  fs.mkdirSync(config.configDir, { recursive: true, mode: 0o700 });

  const server = createEduTerminalServer({ config: overrides });
  await server.listen();

  if (options.workspace) {
    server.state.workspace = {
      fullName: path.basename(path.resolve(options.workspace)),
      branch: null,
      path: path.resolve(options.workspace),
      permissions: { push: true, pull: true, admin: false },
      local: true,
    };
  }

  let pairingResult = null;
  if (options.pair) {
    pairingResult = server.pairing.startPairing({ label: os.hostname() });
  }

  banner(server, pairingResult, options);
  log(`servidor iniciado em ${server.config.host}:${server.actualPort()}`);

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log(`encerrando (${signal})...`);
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[eduterminal] falha ao iniciar:", error);
  process.exit(1);
});
