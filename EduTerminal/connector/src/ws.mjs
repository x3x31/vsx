import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PAYLOAD = 4 * 1024 * 1024;

function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const length = data.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

function unmask(payload, mask) {
  const output = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i++) output[i] = payload[i] ^ mask[i & 3];
  return output;
}

export class WsConnection {
  constructor(socket, req = null) {
    this.socket = socket;
    this.req = req;
    this.remoteAddress = socket.remoteAddress || null;
    this.closed = false;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.onMessage = () => {};
    this.onClose = () => {};

    socket.on("data", (chunk) => this.feed(chunk));
    socket.on("error", () => this.close(1006, "socket error"));
    socket.on("close", () => {
      if (this.closed) return;
      this.closed = true;
      this.onClose();
    });
  }

  send(value) {
    if (this.closed || this.socket.destroyed) return false;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return this.#write(encodeFrame(0x1, text));
  }

  sendBinary(buffer) {
    if (this.closed || this.socket.destroyed) return false;
    return this.#write(encodeFrame(0x2, buffer));
  }

  close(code = 1000, reason = "") {
    if (this.closed || this.socket.destroyed) return;
    const reasonBuffer = Buffer.from(String(reason).slice(0, 120), "utf8");
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.#write(encodeFrame(0x8, payload));
    this.closed = true;
    this.socket.end();
    try {
      this.onClose();
    } catch {
      // ignore
    }
  }

  feed(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);

    for (;;) {
      if (this.buffer.length < 2) return;
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) {
          this.close(1009, "payload muito grande");
          return;
        }
        length = Number(big);
        offset = 10;
      }

      if (length > MAX_PAYLOAD) {
        this.close(1009, "payload muito grande");
        return;
      }

      let mask = null;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + length) return;

      let payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (masked) payload = unmask(payload, mask);

      if (opcode === 0x0) {
        // continuação
        this.fragments.push(payload);
        if (fin) {
          const complete = Buffer.concat(this.fragments);
          const messageOpcode = this.fragmentOpcode;
          this.fragments = [];
          this.fragmentOpcode = null;
          this.#deliver(messageOpcode, complete);
        }
        continue;
      }

      if (opcode === 0x1 || opcode === 0x2) {
        if (fin) {
          this.#deliver(opcode, payload);
        } else {
          this.fragments = [payload];
          this.fragmentOpcode = opcode;
        }
        continue;
      }

      if (opcode === 0x8) {
        // close
        this.close(1000, "");
        return;
      }
      if (opcode === 0x9) {
        // ping
        this.#write(encodeFrame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) {
        // pong
        continue;
      }
      // opcode desconhecido: fecha
      this.close(1003, "opcode não suportado");
      return;
    }
  }

  #deliver(opcode, payload) {
    try {
      if (opcode === 0x2) this.onMessage(payload, true);
      else this.onMessage(payload.toString("utf8"), false);
    } catch {
      // um handler com erro não deve derrubar o socket
    }
  }

  #write(frame) {
    try {
      return this.socket.write(frame);
    } catch {
      return false;
    }
  }
}

export class WsServer {
  constructor({ path = "/ws", onConnection } = {}) {
    this.path = path;
    this.onConnection = onConnection || (() => {});
  }

  attach(server) {
    server.on("upgrade", (req, socket, head) => {
      let url;
      try {
        url = new URL(req.url, "http://localhost");
      } catch {
        socket.destroy();
        return;
      }
      if (url.pathname !== this.path) {
        socket.destroy();
        return;
      }

      const key = req.headers["sec-websocket-key"];
      if (!key) {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      const accept = createHash("sha1").update(key + GUID).digest("base64");
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "\r\n",
        ].join("\r\n"),
      );

      const connection = new WsConnection(socket, req);
      this.onConnection(connection, req, url);
      if (head?.length) connection.feed(head);
    });
  }
}
