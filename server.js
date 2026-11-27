/* Tiny static server + LAN WebSocket game server for Royal 3D Chess. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Chess } = require('chess.js');
const { WebSocketServer } = require('ws');

// LAN play is for trusted, same-network use only — no auth, no special headers.

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (urlPath === '/') urlPath = '/index.html';

  // prevent path traversal
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

// --- LAN game rooms -------------------------------------------------------
// code -> { game: Chess, players: Map<socket, color> }  (max 2 players)
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function newCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function state(room) {
  return { fen: room.game.fen(), history: room.game.history() };
}

function send(ws, obj) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  } catch { /* dead socket — ignore */ }
}

function broadcast(room, obj) {
  for (const ws of room.players.keys()) send(ws, obj);
}

function removeFromRoom(ws) {
  const code = ws.roomCode;
  if (!code) return;
  ws.roomCode = null;
  const room = rooms.get(code);
  if (!room) return;
  room.players.delete(ws);
  if (room.players.size > 0) {
    for (const peer of room.players.keys()) send(peer, { t: 'peer-left' });
  } else {
    rooms.delete(code);
  }
}

// Same HTTP server, WebSocket upgrade only on /lan → ws://<location.host>/lan
const wss = new WebSocketServer({ server, path: '/lan' });

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.on('error', () => {}); // don't let a bad socket take down the server

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { t: 'error', msg: 'Bad message' }); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') {
      return send(ws, { t: 'error', msg: 'Bad message' });
    }

    switch (msg.t) {
      case 'create': {
        removeFromRoom(ws);
        const code = newCode();
        const room = { game: new Chess(), players: new Map() };
        room.players.set(ws, 'w');
        rooms.set(code, room);
        ws.roomCode = code;
        send(ws, { t: 'joined', code, color: 'w', waiting: true, ...state(room) });
        break;
      }

      case 'join': {
        let code;
        try { code = String(msg.code == null ? '' : msg.code).trim().toUpperCase(); }
        catch { return send(ws, { t: 'error', msg: 'Bad message' }); }
        if (ws.roomCode === code) return send(ws, { t: 'error', msg: 'Already in this room' });
        const room = rooms.get(code);
        if (!room) return send(ws, { t: 'error', msg: 'Room not found' });
        if (room.players.size >= 2) return send(ws, { t: 'error', msg: 'Room is full' });
        // Assign the vacant colour. If White disconnected, the survivor is Black
        // and the new player must take White — never put two players on Black.
        const colors = [...room.players.values()];
        const color = colors.includes('w') ? 'b' : 'w';
        removeFromRoom(ws);
        room.players.set(ws, color);
        ws.roomCode = code;
        const snap = state(room);
        send(ws, { t: 'joined', code, color, waiting: false, ...snap });
        broadcast(room, { t: 'start', ...snap });
        break;
      }

      case 'move': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.players.size !== 2) return send(ws, { t: 'error', msg: 'Illegal move' });
        if (room.game.turn() !== room.players.get(ws)) {
          return send(ws, { t: 'error', msg: 'Not your turn' });
        }
        const from = typeof msg.from === 'string' ? msg.from : '';
        const to = typeof msg.to === 'string' ? msg.to : '';
        const promotion = typeof msg.promotion === 'string' ? msg.promotion : undefined;
        let result;
        try { result = room.game.move({ from, to, promotion }); }
        catch { result = null; }
        if (!result) return send(ws, { t: 'error', msg: 'Illegal move' });
        broadcast(room, {
          t: 'move', from, to, promotion: promotion || undefined,
          fen: room.game.fen(), history: room.game.history(),
        });
        break;
      }

      case 'reset': {
        const room = rooms.get(ws.roomCode);
        if (!room) return send(ws, { t: 'error', msg: 'Bad message' });
        room.game = new Chess();
        broadcast(room, { t: 'reset', ...state(room) });
        break;
      }

      case 'leave':
        removeFromRoom(ws);
        break;

      default:
        send(ws, { t: 'error', msg: 'Bad message' });
    }
  });

  ws.on('close', () => removeFromRoom(ws));
});

function lanUrls() {
  const urls = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        urls.push(`http://${iface.address}:${PORT}`);
      }
    }
  }
  return urls;
}

server.listen(PORT, () => {
  const urls = [`http://localhost:${PORT}`, ...lanUrls()];
  console.log(`\n  ♞ Royal 3D Chess →  ${urls.join('\n                      ')}\n`);
});
