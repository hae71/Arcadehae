/**
 * ArcadeHae — Real-time UNO game server
 * ----------------------------------------------------------------
 * - Serves the client HTML (static file)
 * - Accepts WebSocket connections
 * - Puts players in a matchmaking queue
 * - Once 2 players are queued, creates a UnoGame and relays moves
 *   between the two connected clients in real time
 *
 * Protocol (JSON messages over the socket):
 *   Client -> Server:
 *     { type: 'join_queue', name?: string }
 *     { type: 'play_card', cardId: string }
 *     { type: 'draw_card' }
 *
 *   Server -> Client:
 *     { type: 'queued' }
 *     { type: 'match_found', state }
 *     { type: 'state_update', state }
 *     { type: 'match_over', winner, state }
 *     { type: 'error', message }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WSServer } = require('./mini-ws');
const { UnoGame } = require('./uno-engine');

const PORT = process.env.PORT || 8787;

// ---- static file server (serves client.html) ----
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'client.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Could not load client.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WSServer({ server });

// ---- matchmaking + match registry ----
let waitingPlayer = null; // { conn, id }
const matchesByPlayerId = new Map(); // playerId -> { game, connsById }

let nextPlayerId = 1;

function broadcastState(match) {
  for (const [pid, conn] of Object.entries(match.connsById)) {
    conn.send({ type: 'state_update', state: match.game.getStateFor(pid) });
  }
}

function sendError(conn, message) {
  conn.send({ type: 'error', message });
}

wss.on('connection', (conn) => {
  const playerId = `player-${nextPlayerId++}`;
  conn._playerId = playerId;

  conn.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return sendError(conn, 'Invalid message format');
    }

    if (msg.type === 'join_queue') {
      if (waitingPlayer === null) {
        waitingPlayer = { conn, id: playerId };
        conn.send({ type: 'queued' });
        console.log(`${playerId} joined the queue`);
        return;
      }

      // pair with the waiting player
      const opponent = waitingPlayer;
      waitingPlayer = null;

      const game = new UnoGame([opponent.id, playerId]);
      const connsById = { [opponent.id]: opponent.conn, [playerId]: conn };
      const match = { game, connsById };

      matchesByPlayerId.set(opponent.id, match);
      matchesByPlayerId.set(playerId, match);

      for (const [pid, c] of Object.entries(connsById)) {
        c.send({ type: 'match_found', state: game.getStateFor(pid) });
      }
      console.log(`Match started: ${opponent.id} vs ${playerId}`);
      return;
    }

    const match = matchesByPlayerId.get(playerId);
    if (!match) {
      return sendError(conn, 'You are not in a match yet — send join_queue first');
    }

    try {
      if (msg.type === 'play_card') {
        const result = match.game.playCard(playerId, msg.cardId);
        if (result.finished) {
          for (const [pid, c] of Object.entries(match.connsById)) {
            c.send({ type: 'match_over', winner: result.winner, state: match.game.getStateFor(pid) });
          }
          matchesByPlayerId.delete(match.game.players[0]);
          matchesByPlayerId.delete(match.game.players[1]);
        } else {
          broadcastState(match);
        }
      } else if (msg.type === 'draw_card') {
        match.game.drawCard(playerId);
        broadcastState(match);
      } else {
        sendError(conn, `Unknown message type: ${msg.type}`);
      }
    } catch (err) {
      sendError(conn, err.message);
    }
  });

  conn.on('close', () => {
    console.log(`${playerId} disconnected`);
    if (waitingPlayer && waitingPlayer.id === playerId) {
      waitingPlayer = null;
    }
    const match = matchesByPlayerId.get(playerId);
    if (match) {
      const opponentId = match.game.players.find((p) => p !== playerId);
      const opponentConn = match.connsById[opponentId];
      if (opponentConn) {
        opponentConn.send({ type: 'error', message: 'Your opponent disconnected' });
      }
      matchesByPlayerId.delete(match.game.players[0]);
      matchesByPlayerId.delete(match.game.players[1]);
    }
  });
});

server.listen(PORT, () => {
  console.log(`ArcadeHae UNO server running at http://localhost:${PORT}`);
});
