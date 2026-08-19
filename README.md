# ArcadeHae — Live UNO Server (v1 prototype)

A working real-time 1v1 UNO match: two browser tabs, live moves synced over WebSocket, server-side rule enforcement.

## Files

- `uno-engine.js` — the game rules (deck, dealing, move validation, win detection). No networking; pure logic, so it's easy to test and later reuse.
- `mini-ws.js` — a small WebSocket server built only from Node's built-in modules (no `npm install` needed — this sandbox has no network access to fetch packages). In a real deployment, swap this for the `ws` npm package; the `.on('connection')` / `.send()` API was kept the same on purpose to make that swap a one-line change.
- `server.js` — ties it together: serves `client.html`, holds the matchmaking queue, creates a `UnoGame` per match, relays moves between the two connected players.
- `client.html` — the browser UI. Connects over WebSocket, shows your hand, lets you tap a legal card to play it or draw if you can't.
- `simulate-match.js` / `test-rules.js` / `test-live-match.js` — verification scripts (bot-vs-bot match, rule-cheating rejection tests, and a full two-socket live match test). All pass.

## Run it locally

```bash
node server.js
```

Then open **two separate browser tabs** at `http://localhost:8787`, click "Find a Match" in both, and play — each tap sends a real move to the server, which validates it and pushes the updated state to both tabs.

## What's next for a real launch

1. **Deploy** this server somewhere with a persistent process (Railway, Render, a small VPS) — it currently only runs on your machine.
2. **Swap `mini-ws.js` for the `ws` npm package** once you have internet/npm access — it's more battle-tested for production traffic.
3. **Add authentication** so `player-1` becomes a real logged-in user, not just a connection ID.
4. **Wire in the payment gateway** (Moyasar/Stripe) so a player must pay before `join_queue` is accepted.
5. **Persist match history** to a database (PostgreSQL) for the wallet/prize logic.
