# Space Pong

Multiplayer Pong in a space-themed polygon arena. Plain HTML, CSS and JavaScript (no build step), played peer-to-peer over WebRTC and hosted as a static site on GitHub Pages.

## How to play

1. **Host**: open the page, enter a callsign, press **Host a match**. In the *Invite players* panel, press **+ New invite** and send the **offer code** to a player.
2. **Player**: press **Join a match**, paste the offer code, press **Create answer** and send the **answer code** back to the host.
3. **Host**: paste the answer code into the invite and press **Connect**. Repeat for every player; players can join (or leave) at any time.

Controls: `←` `→` or `A` `D` to move your paddle, `M` to mute.

Rules: every player defends one side of a polygon that gains a side per player (2 players or fewer play on a square). Missing the ball adds to your *lost points*; the ball resets and play continues forever. There is no winner and no fixed player cap.

## Networking notes

- No game server and no signaling server: codes are exchanged manually.
- The host simulates the match and streams snapshots (30 Hz) over WebRTC data channels; each player sends only their own paddle position.
- Only public STUN servers are used (no TURN). Some networks (symmetric NAT, strict firewalls) will block direct connections.
- Keep the host tab visible: browsers throttle background tabs, which pauses the host's simulation.

## Develop

```
npm test        # unit tests (Node's built-in test runner, no dependencies)
npm start       # serve at http://localhost:8080 (ES modules need http://)
```

Layout: `src/game.js` (pure game logic), `src/session.js` (WebRTC host/client), `src/signal.js` (offer/answer codes), `src/render.js`, `src/sound.js`, `src/main.js` (UI).

## Deploy

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs the tests on every push and pull request, and on pushes to `main` publishes `index.html`, `css/` and `src/` to GitHub Pages. In the repository, set **Settings → Pages → Source** to **GitHub Actions** (one-time).
