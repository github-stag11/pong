# Multiplayer Space Pong

## Goal

Create a playable, browser-based multiplayer Pong game with a space theme. Build it with HTML, CSS, and JavaScript, and make it deployable as a static site on GitHub Pages.

## Gameplay

- All players join one shared match.
- The arena is a polygon with one defendable side and paddle per player. Add sides as players join.
- Keep the match running indefinitely; there is no winner or win condition.
- When a player misses the ball, increment that player's lost-points counter, reset the ball, and continue play.
- Display each player's lost-points total.
- Do not impose a fixed player-count cap in the game logic. The practical maximum will depend on browser, device, and network limits.

## Multiplayer and deployment

- Use direct peer-to-peer browser connections; do not require a signaling or game server.
- Host the static game files on GitHub Pages.
- The host creates the match and manually shares a WebRTC offer with each player. Each player returns an answer to the host to connect.
- The host device coordinates the match state. Game traffic travels over the peer connections rather than through a central game server.
- A STUN service may be used to help peers connect over the internet. Do not use a TURN relay. Connections may not work on networks that block direct peer-to-peer traffic.

## Look and controls

- Use a space-inspired visual theme.
- Support keyboard controls on desktop.

## Core deliverable

A playable online browser game built with HTML, CSS, and JavaScript, with its static files ready to deploy to GitHub Pages.
