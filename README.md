# Space Pong

Multiplayer Pong in a space-themed polygon arena. Plain HTML, CSS and JavaScript (no build step), played peer-to-peer over WebRTC and hosted as a static site on GitHub Pages.

## How to play

1. **Everyone**: open the page, enter a callsign, press **Play**.
2. If no match is running, you become the host and wait. Otherwise you join the match in progress automatically.

Controls: `←` `→` or `A` `D` to move your paddle, `M` to mute.

Rules: every player defends one side of a polygon that gains a side per player (2 players or fewer play on a square). Missing the ball adds to your *lost points*; the ball resets and play continues forever. There is no winner and no fixed player cap.

## Networking notes

- There is one shared lobby. Players find the match through a public MQTT broker (`wss://broker.hivemq.com:8884/mqtt`) that only relays the connection setup (SDP offers and answers). No game traffic goes through the broker or any game server.
- The lobby is open: anyone can see or inject messages on it, and the broker is a third-party service with no uptime guarantee.
- Players connect directly over WebRTC. The host simulates the match and streams snapshots (30 Hz) over data channels; each player sends only their own paddle position.
- Only public STUN servers are used (no TURN). Some networks (symmetric NAT, strict firewalls) will block direct connections.
- If the host leaves, the remaining players see a "Disconnected" screen; reloading the page returns them to the menu.
- Keep the host tab visible: browsers throttle background tabs, which pauses the host's simulation.
- If two players press Play at the same moment, both may become host. Each host runs its own match.

## Develop

```
npm test        # unit tests (Node's built-in test runner, no dependencies)
npm start       # serve at http://localhost:8080 (ES modules need http://)
```

Layout: `src/game.js` (pure game logic), `src/lobby.js` (MQTT signaling), `src/session.js` (WebRTC host/client), `src/render.js`, `src/sound.js`, `src/main.js` (UI).

## Deploy

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs the tests on every push and pull request, and on pushes to `main` publishes `index.html`, `css/` and `src/` to GitHub Pages. In the repository, set **Settings → Pages → Source** to **GitHub Actions** (one-time).
