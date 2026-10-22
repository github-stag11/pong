// Pure game logic: no DOM, no networking. Shared by host simulation, client rendering and tests.
// World units: the arena is a regular polygon with circumradius 1, centred on the origin.

export const R = 1;
export const BALL_RADIUS = 0.035;
export const SERVE_DELAY = 1.2;
export const BASE_SPEED = 0.85;
export const MAX_SPEED = 2.2;
export const PADDLE_RATE = 3; // paddle position units (-1..1) per second

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round4 = (v) => Math.round(v * 10000) / 10000;

export function createState() {
  return { players: [], ball: { x: 0, y: 0, vx: 0, vy: 0 }, serve: SERVE_DELAY };
}

// Number of polygon sides and the side owned by each player (by join order).
// Fewer than 3 players still gets a playable square; extra sides act as walls.
export function layout(playerCount) {
  if (playerCount <= 0) return { sides: 4, slots: [] };
  if (playerCount === 1) return { sides: 4, slots: [0] };
  if (playerCount === 2) return { sides: 4, slots: [0, 2] };
  return { sides: playerCount, slots: Array.from({ length: playerCount }, (_, i) => i) };
}

const geometryCache = new Map();

// Side i faces angle am = PI/2 + 2*PI*i/n (side 0 is at the bottom of an unrotated screen).
// t runs left-to-right when the side is at the bottom of the screen.
export function geometry(n) {
  let g = geometryCache.get(n);
  if (g) return g;
  const apothem = Math.cos(Math.PI / n) * R;
  const len = 2 * R * Math.sin(Math.PI / n);
  g = [];
  for (let i = 0; i < n; i++) {
    const am = Math.PI / 2 + (2 * Math.PI * i) / n;
    const ox = Math.cos(am);
    const oy = Math.sin(am);
    const tx = Math.sin(am);
    const ty = -Math.cos(am);
    const mx = ox * apothem;
    const my = oy * apothem;
    g.push({
      i, am, len, mx, my, nx: -ox, ny: -oy, tx, ty,
      ax: mx - (tx * len) / 2, ay: my - (ty * len) / 2,
      bx: mx + (tx * len) / 2, by: my + (ty * len) / 2,
    });
  }
  geometryCache.set(n, g);
  return g;
}

export function paddleLength(sideLen) {
  return Math.max(0.4 * sideLen, Math.min(0.8 * sideLen, 0.14));
}

export function paddleCenter(sideLen, pos) {
  return (pos * (sideLen - paddleLength(sideLen))) / 2;
}

export function addPlayer(state, id, name) {
  state.players.push({ id, name, pos: 0, lost: 0, input: 0 });
  resetBall(state);
}

export function removePlayer(state, id) {
  const i = state.players.findIndex((p) => p.id === id);
  if (i < 0) return false;
  state.players.splice(i, 1);
  resetBall(state);
  return true;
}

export function sideOf(state, id) {
  const i = state.players.findIndex((p) => p.id === id);
  return i < 0 ? -1 : layout(state.players.length).slots[i];
}

export function resetBall(state) {
  state.ball = { x: 0, y: 0, vx: 0, vy: 0 };
  state.serve = SERVE_DELAY;
}

function launch(state, rand) {
  const a = rand() * Math.PI * 2;
  state.ball.vx = Math.cos(a) * BASE_SPEED;
  state.ball.vy = Math.sin(a) * BASE_SPEED;
}

// Advances the simulation. Returns events: {type:'hit'|'wall'|'miss', id?}.
export function step(state, dt, rand = Math.random) {
  const events = [];
  for (const p of state.players) {
    if (p.input) p.pos = clamp(p.pos + p.input * PADDLE_RATE * dt, -1, 1);
  }

  const b = state.ball;
  if (state.serve > 0) {
    state.serve -= dt;
    if (state.serve <= 0) {
      state.serve = 0;
      launch(state, rand);
    }
    return events;
  }

  const speed = Math.hypot(b.vx, b.vy);
  const substeps = Math.max(1, Math.ceil((speed * dt) / (BALL_RADIUS * 0.5)));
  const h = dt / substeps;
  for (let k = 0; k < substeps; k++) {
    b.x += b.vx * h;
    b.y += b.vy * h;
    if (collide(state, events)) break;
  }
  return events;
}

function collide(state, events) {
  const b = state.ball;
  const r = BALL_RADIUS;
  const { sides, slots } = layout(state.players.length);
  const geo = geometry(sides);

  for (const g of geo) {
    const dx = b.x - g.mx;
    const dy = b.y - g.my;
    const d = dx * g.nx + dy * g.ny; // distance inside the arena (negative = outside)
    if (d >= r) continue;
    const vn = b.vx * g.nx + b.vy * g.ny;
    if (vn >= 0) continue;

    const owner = state.players[slots.indexOf(g.i)];
    if (!owner) {
      b.vx -= 2 * vn * g.nx;
      b.vy -= 2 * vn * g.ny;
      b.x += g.nx * (r - d);
      b.y += g.ny * (r - d);
      events.push({ type: 'wall' });
      continue;
    }

    if (d > -r) {
      const pl = paddleLength(g.len);
      const off = dx * g.tx + dy * g.ty - paddleCenter(g.len, owner.pos);
      if (Math.abs(off) <= pl / 2 + r * 0.8) {
        paddleBounce(b, g, vn, clamp(off / (pl / 2), -1, 1));
        b.x += g.nx * (r - d);
        b.y += g.ny * (r - d);
        events.push({ type: 'hit', id: owner.id });
        continue;
      }
    }

    if (d < -2 * r) {
      owner.lost++;
      events.push({ type: 'miss', id: owner.id });
      resetBall(state);
      return true;
    }
  }
  return false;
}

function paddleBounce(b, g, vn, h) {
  const speed = Math.hypot(b.vx, b.vy);
  const vt = b.vx * g.tx + b.vy * g.ty;
  let nvt = vt * 0.4 + h * speed * 0.8;
  let nvn = Math.max(-vn, speed * 0.35);
  const newSpeed = Math.min(MAX_SPEED, speed * 1.05 + 0.02);
  const norm = Math.hypot(nvt, nvn);
  nvt *= newSpeed / norm;
  nvn *= newSpeed / norm;
  b.vx = g.nx * nvn + g.tx * nvt;
  b.vy = g.ny * nvn + g.ty * nvt;
}

// ---- Network (de)serialisation helpers ----

export function exportRoster(state) {
  return state.players.map(({ id, name, lost }) => ({ id, name, lost }));
}

export function applyRoster(state, roster) {
  const old = new Map(state.players.map((p) => [p.id, p]));
  state.players = roster.map(({ id, name, lost }) => {
    const prev = old.get(id);
    return { id, name, lost, pos: prev ? prev.pos : 0, input: prev ? prev.input : 0 };
  });
}

// [seq, rosterVersion, bx, by, bvx, bvy, serve, ...paddle positions in roster order]
export function encodeSnapshot(state, seq, rv) {
  const b = state.ball;
  return [seq, rv, round4(b.x), round4(b.y), round4(b.vx), round4(b.vy), round4(state.serve),
    ...state.players.map((p) => round4(p.pos))];
}

export function applySnapshot(state, snap, rv, ownId) {
  if (!Array.isArray(snap) || snap.length < 7 || !snap.every(Number.isFinite)) return;
  state.ball = { x: snap[2], y: snap[3], vx: snap[4], vy: snap[5] };
  state.serve = snap[6];
  if (snap[1] !== rv) return;
  state.players.forEach((p, i) => {
    if (p.id !== ownId && Number.isFinite(snap[7 + i])) p.pos = clamp(snap[7 + i], -1, 1);
  });
}

export function clampPos(v) {
  return clamp(Number(v) || 0, -1, 1);
}
