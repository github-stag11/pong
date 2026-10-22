# Multiplayer Space Pong

## Goal

Create a playable, browser-based multiplayer Pong game with a space theme. Build it with HTML, CSS, and JavaScript, and make it deployable as a static site on GitHub Pages.

## Gameplay

- All players join one shared match.
- The arena is a polygon with one defendable side and paddle per player. Add sides as players join.
- Keep the match running indefinitely; there is no winner or win condition.
- When a player misses the ball, increment that player's lost-points counter, reset the ball, and continue play.
- Display each player's lost-points total.
- Timed bonuses: a pickup appears at a random spot in the arena and expires after about 10 seconds if nobody takes it. At most two pickups are on the field, and new ones spawn every 8 to 15 seconds.
- Only the paddle that hit the ball last can collect a pickup it touches. Nobody collects while the ball is in play with no last hitter.
- Bonus types: `big` (the collector's paddle grows 1.5x for 8 seconds), `small` (every rival's paddle shrinks to 0.6x for 8 seconds), `multi` (the ball splits into extra balls, up to 3 at once; a miss removes only that ball), `shield` (the collector's next would-be miss reflects the ball instead, for up to 8 seconds), and `speed` (the ball speed changes randomly, up or down, and is clamped to a safe range).
- Do not impose a fixed player-count cap in the game logic. The practical maximum will depend on browser, device, and network limits.

## Multiplayer and deployment

- Players find each other through a public MQTT broker (`wss://broker.hivemq.com:8884/mqtt`) that relays only the WebRTC connection setup. The lobby is one shared match: a player who presses Play joins the match in progress, or starts one if none is announced.
- Game traffic travels over direct peer-to-peer connections. There is no game server, and the broker never sees game state.
- The host device coordinates the match state.
- A STUN service helps peers find each other over the internet. A TURN relay (Metered Open Relay, free tier) carries game traffic only for peers whose networks block a direct connection. The TURN credentials are fetched from the browser, so the site stays static.

## Look and controls

- Use a space-inspired visual theme.
- Support keyboard controls on desktop.

## Core deliverable

A playable online browser game built with HTML, CSS, and JavaScript, with its static files ready to deploy to GitHub Pages.
