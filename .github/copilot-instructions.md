# Copilot instructions for Space Pong

Multiplayer Pong in a polygon arena. Plain HTML, CSS and ES modules with no build step and no dependencies. Players connect peer-to-peer over WebRTC, and the site is deployed as static files to GitHub Pages. See `README.md` for the player-facing rules and `brief.md` for the original product brief.

## Commands

- `npm test`: runs all tests with Node's built-in runner (`node --test "tests/*.test.js"`). CI uses Node 22; `engines` is `>=20`.
- Single file: `node --test tests/game.test.js`
- Single test by name: `node --test --test-name-pattern="paddle returns the ball" tests/game.test.js`
- `npm start`: static server at http://localhost:8080 (`PORT` overrides). Serve over http; ES modules do not load from `file://`.
- There is no linter, formatter, type checker or build step. Do not run `npm install`; there are no dependencies. The MQTT client is loaded from esm.sh at runtime.
- CI (`.github/workflows/deploy.yml`) runs `npm test` on every push and pull request. Pushes to `main` also copy `index.html`, `css/` and `src/` into `_site/` and deploy it to Pages.

## Architecture

Modules are split by where they can run. Only the pure modules are unit-tested in Node.

- `src/game.js`: pure game logic. Geometry, paddles, ball physics (`step`), and roster and snapshot encoding and decoding. No DOM and no network.
- `src/sim-core.js`: `MatchSim` wraps `game.js` for the host. It tracks the roster version (`rv`), the snapshot sequence, and a 30 Hz send flag. Pure.
- `src/sim-worker.js`: runs `MatchSim` in a Web Worker on a 60 Hz `setInterval`, so the match keeps running in background tabs. Messages in: `init`, `add`, `remove`, `pos`, `input`. Messages out: `roster`, `tick`.
- `src/session.js`: `HostSession` and `ClientSession` manage the WebRTC peers. Both expose `state`, `myId`, `setInput(dir)` and `tick(dt)`, so `main.js` and `render.js` treat them the same way.
- `src/lobby.js`: MQTT signaling only. It carries the SDP offer and answer and nothing else.
- `src/main.js`: menu, input, HUD and the game loop. `src/render.js` (canvas) and `src/sound.js` (WebAudio) are browser-only.

**Join flow:** Play calls `findHost()`, which looks for a retained host announcement on the broker. If there is none, `hostLobby()` announces this player and creates a `HostSession`. Otherwise `joinHost()` sends an offer to that host and receives the answer. Once the SDP exchange is done, the game traffic no longer uses MQTT.

**Host-authoritative state:**
- The worker runs the whole simulation. The host's main thread mirrors the roster (`applyRoster`) and forwards snapshots to clients. Clients send only their own paddle position (`{p}`) and dead-reckon the ball between snapshots.
- The host's own player always has id `0`. Remote players get ids from `HostSession.nextId`. A client learns its id from `welcome`.
- Two data channels are pre-negotiated with fixed ids on both sides, so do not use `ondatachannel`:
  - `ctrl` (id 0, reliable, JSON): `hello`, `welcome`, `roster`, `ev` (`hit` / `wall` / `miss`).
  - `stream` (id 1, unordered, `maxRetransmits: 0`): snapshot arrays and `{p}` paddle updates. Lost packets are acceptable.
- A snapshot is a positional array: `[seq, rv, bx, by, bvx, bvy, serve, ...paddle positions in roster order]`. Paddle positions apply only when the snapshot's `rv` matches the client's roster version. Adding or removing a player bumps `rv`, and the worker posts the roster before each tick so the forwarded `rv` is current. If you change the layout, update `encodeSnapshot`, `applySnapshot` and the tests that index into the array (for example `snap[8]`).

**Geometry:**
- The arena is a regular polygon with circumradius 1 centred on the origin. Side `i` faces angle `PI/2 + 2πi/n`.
- `layout(playerCount)` assigns sides. One or two players share a square (slots `[0]` or `[0, 2]`). Three or more players get one side each. Sides with no owner act as walls.
- `slots[i]` is the side index for `state.players[i]`. It is a side index, not a player id.
- The renderer rotates the view so the local player's side is at the bottom of the screen.

## Conventions

- Keep pure logic in `game.js` and `sim-core.js`, and inject randomness and time rather than reading them globally: `step(state, dt, rand)` and `new MatchSim(id, name, rand)`. Tests pass a seeded generator instead of `Math.random`.
- Tests use `node:test` with `node:assert/strict`. Test names are sentences that describe behaviour.
- Do not import browser-only modules (`session.js`, `lobby.js`, `render.js`, `sound.js`, `main.js`, `sim-worker.js`) from tests. They use `RTCPeerConnection`, `Worker`, `document`, `self` and remote URLs, so they fail under Node.
- Network handlers silence expected failures (peer or broker already gone) with empty `catch` blocks. Follow that pattern and keep errors from escaping message handlers.
- Each module starts with a header comment describing its role and constraints. Put "why" explanations there.
- Create the sim worker with `new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' })`. This form resolves correctly in the deployed `_site/` copy.
- Style: 2-space indent, single quotes, semicolons, trailing commas in multi-line literals.

## Deployment gotcha

`src/session.js` contains the placeholder `YOUR_METERED_API_KEY` in `TURN_CREDENTIALS_URL`. Never commit a real key. CI runs `sed` on the copy in `_site/` to substitute the `METERED_API_KEY` secret. If you rename or move the placeholder, the substitution silently does nothing. `fetchIceServers()` then falls back to STUN only, and TURN relaying stops working for players behind strict NATs.
