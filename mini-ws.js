/**
 * ArcadeHae — Minimal WebSocket server (Node core modules only)
 * ----------------------------------------------------------------
 * A small, dependency-free implementation of RFC 6455 (WebSocket),
 * built because this sandbox has no network access to `npm install`
 * a package like `ws`. In production, swap this for the real `ws`
 * or Socket.io package — same `.on('connection')` / `.send()` shape
 * is kept here on purpose to make that swap trivial later.
 *
 * Supports: text frames only (JSON messages), which is all the
 * ArcadeHae protocol needs.
 */

const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this._buffer = Buffer.alloc(0);
    this.isAlive = true;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this.emit('close'));
    socket.on('error', (err) => this.emit('error', err));
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    this._tryParseFrames();
  }

  _tryParseFrames() {
    while (this._buffer.length >= 2) {
      const buf = this._buffer;
      const firstByte = buf[0];
      const secondByte = buf[1];

      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buf.length < offset + 2) return;
        payloadLen = buf.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLen === 127) {
        if (buf.length < offset + 8) return;
        // JS bitwise ops are 32-bit; read as BigInt then convert (payloads here are always small)
        payloadLen = Number(buf.readBigUInt64BE(offset));
        offset += 8;
      }

      let maskKey;
      if (isMasked) {
        if (buf.length < offset + 4) return;
        maskKey = buf.slice(offset, offset + 4);
        offset += 4;
      }

      if (buf.length < offset + payloadLen) return; // wait for more data

      let payload = buf.slice(offset, offset + payloadLen);
      if (isMasked) {
        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
        payload = unmasked;
      }

      this._buffer = buf.slice(offset + payloadLen);

      if (opcode === 0x8) {
        // close frame
        this.socket.end();
        this.emit('close');
        return;
      } else if (opcode === 0x1) {
        // text frame
        this.emit('message', payload.toString('utf8'));
      } else if (opcode === 0x9) {
        // ping -> reply pong
        this._writeFrame(payload, 0xa);
      } else if (opcode === 0xa) {
        // pong
        this.isAlive = true;
      }
    }
  }

  _writeFrame(payload, opcode = 0x1) {
    const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    const len = payloadBuf.length;
    let header;

    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    this.socket.write(Buffer.concat([header, payloadBuf]));
  }

  send(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this._writeFrame(payload, 0x1);
  }

  ping() {
    this.isAlive = false;
    this._writeFrame(Buffer.alloc(0), 0x9);
  }

  close() {
    this._writeFrame(Buffer.alloc(0), 0x8);
    this.socket.end();
  }
}

class WSServer extends EventEmitter {
  constructor({ server }) {
    super();
    this.httpServer = server;
    this.httpServer.on('upgrade', (req, socket) => this._handleUpgrade(req, socket));
  }

  _handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers['upgrade'] || '').toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      '',
    ].join('\r\n');

    socket.write(responseHeaders);

    const conn = new WSConnection(socket);
    this.emit('connection', conn, req);
  }
}

module.exports = { WSServer, WSConnection };
