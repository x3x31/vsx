import assert from "node:assert/strict";
import test from "node:test";
import { pairToken, startServer } from "./helpers.mjs";

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("falha ao abrir o WebSocket")), {
      once: true,
    });
  });
}

function waitFor(socket, predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("tempo esgotado esperando mensagem do WebSocket"));
    }, timeout);

    const onMessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket fechado antes da mensagem esperada"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

test("WebSocket: autenticação, sessão, entrada/saída e encerramento", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { token } = await pairToken(base);
  const socket = await openSocket(`${base.replace("http", "ws")}/ws`);

  const authPromise = waitFor(socket, (message) => message.type === "auth.ok");
  socket.send(JSON.stringify({ type: "auth", token }));
  const auth = await authPromise;
  assert.equal(auth.type, "auth.ok");

  const pingPromise = waitFor(socket, (message) => message.type === "pong");
  socket.send(JSON.stringify({ type: "ping", t: 123 }));
  const pong = await pingPromise;
  assert.equal(pong.t, 123);

  const createdPromise = waitFor(socket, (message) => message.type === "session.created");
  socket.send(
    JSON.stringify({
      type: "session.create",
      name: "teste",
      shell: process.execPath,
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      cols: 80,
      rows: 24,
    }),
  );
  const created = await createdPromise;
  assert.ok(created.session.id);

  const outputPromise = waitFor(
    socket,
    (message) =>
      message.type === "session.output" &&
      message.sessionId === created.session.id &&
      message.data.includes("ola-eduterminal"),
  );
  socket.send(
    JSON.stringify({
      type: "session.input",
      sessionId: created.session.id,
      data: "ola-eduterminal\n",
    }),
  );
  const output = await outputPromise;
  assert.match(output.data, /ola-eduterminal/);

  const exitPromise = waitFor(
    socket,
    (message) =>
      message.type === "session.exit" && message.sessionId === created.session.id,
  );
  socket.send(JSON.stringify({ type: "session.close", sessionId: created.session.id }));
  await exitPromise;

  socket.close();
});

test("WebSocket: token inválido é recusado", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const socket = await openSocket(`${base.replace("http", "ws")}/ws`);
  const errorPromise = waitFor(socket, (message) => message.type === "auth.error");
  socket.send(JSON.stringify({ type: "auth", token: "invalido" }));
  const error = await errorPromise;
  assert.match(error.error, /inválido|expirado/i);
  socket.close();
});

test("WebSocket: mensagem antes da autenticação pede auth", async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const socket = await openSocket(`${base.replace("http", "ws")}/ws`);
  const requiredPromise = waitFor(socket, (message) => message.type === "auth.required");
  socket.send(JSON.stringify({ type: "ping" }));
  await requiredPromise;
  socket.close();
});
