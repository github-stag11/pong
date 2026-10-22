// Pure game logic: no DOM, no networking. Shared by host simulation, client rendering and tests.
// World units: the arena is a regular polygon with circumradius 1, centred on the origin.

import {
  BONUS_KINDS, BONUS_RADIUS, BONUS_TTL, EFFECT_TTL, MAX_BALLS, MAX_FIELD, MULTI_EXTRA,
  SPAWN_MAX, SPAWN_MIN, SPEED_DOWN, SPEED_UP, SPLIT_ANGLE, TIMED_EFFECTS,
  createBonusState, effectScale,
} from './bonus.js';

export const R = 1;
export const BALL_RADIUS = 0.035;
export const SERVE_DELAY = 1.2;
export const BASE_SPEED = 0.85;
export const MAX_SPEED = 2.2;
export const PADDLE_RATE = 3; // paddle position units (-1..1) per second
export const MIN_SPEED = 0.5 * BASE_SPEED;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round4 = (v) => Math.round(v * 10000) / 10000;

export function createState() {
  return { players: [], balls: [], serve: SERVE_DELAY, bonus: createBonusState() };
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

export function paddleLength(sideLen, scale = 1) {
  const base = Math.max(0.4 * sideLen, Math.min(0.8 * sideLen, 0.14));
  return clamp(base * scale, 0.2 * sideLen, 0.8 * sideLen);
}

export function paddleCenter(sideLen, pos, scale = 1) {
  return (pos * (sideLen - paddleLength(sideLen, scale))) / 2;
}

export function addPlayer(state, id, name) {
  state.players.push({ id, name, pos: 0, lost: 0, input: 0, fx: {} });
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
  state.balls = [];
  state.serve = SERVE_DELAY;
}

function launchBall(rand) {
  const a = rand() * Math.PI * 2;
  return { x: 0, y: 0, vx: Math.cos(a) * BASE_SPEED, vy: Math.sin(a) * BASE_SPEED, last: null };
}

// Advances the simulation. Returns events: {type:'hit'|'wall'|'miss'|'shield'|'collect', id?, kind?}.
export function step(state, dt, rand = Math.random) {
  const events = [];
  for (const p of state.players) {
    if (p.input) p.pos = clamp(p.pos + p.input * PADDLE_RATE * dt, -1, 1);
  }
  tickBonus(state, dt, rand);

  if (state.balls.length === 0) {
    state.serve -= dt;
    if (state.serve <= 0) {
      state.serve = 0;
      state.balls.push(launchBall(rand));
    }
    return events;
  }

  const speed = Math.max(...state.balls.map((b) => Math.hypot(b.vx, b.vy)));
  const substeps = Math.max(1, Math.ceil((speed * dt) / (BALL_RADIUS * 0.5)));
  const h = dt / substeps;
  for (let k = 0; k < substeps; k++) {
    for (const b of [...state.balls]) {
      b.x += b.vx * h;
      b.y += b.vy * h;
      if (collide(state, b, events)) continue;
      pickUp(state, b, events, rand);
    }
  }
  return events;
}

function tickBonus(state, dt, rand) {
  for (const p of state.players) {
    for (const k of Object.keys(p.fx)) {
      p.fx[k] -= dt;
      if (p.fx[k] <= 0) delete p.fx[k];
    }
  }
  const bonus = state.bonus;
  for (const f of bonus.field) f.ttl -= dt;
  bonus.field = bonus.field.filter((f) => f.ttl > 0);
  if (bonus.timer === null) bonus.timer = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
  bonus.timer -= dt;
  if (bonus.timer <= 0) {
    bonus.timer = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
    if (bonus.field.length < MAX_FIELD) spawnBonus(state, rand);
  }
}

function spawnBonus(state, rand) {
  const kind = BONUS_KINDS[Math.floor(rand() * BONUS_KINDS.length)];
  const a = rand() * Math.PI * 2;
  const radius = 0.25 + rand() * 0.35;
  state.bonus.field.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, kind, ttl: BONUS_TTL });
}

// Only the player whose paddle the ball hit last can collect a pickup it touches.
function pickUp(state, b, events, rand) {
  if (b.last === null) return;
  const collector = state.players.find((p) => p.id === b.last);
  if (!collector) return;
  const field = state.bonus.field;
  const i = field.findIndex((f) => Math.hypot(b.x - f.x, b.y - f.y) < BALL_RADIUS + BONUS_RADIUS);
  if (i < 0) return;
  const { kind } = field.splice(i, 1)[0];
  events.push({ type: 'collect', id: collector.id, kind });
  if (kind === 'big' || kind === 'shield') {
    collector.fx[kind] = EFFECT_TTL;
  } else if (kind === 'small') {
    for (const p of state.players) if (p !== collector) p.fx.small = EFFECT_TTL;
  } else if (kind === 'multi') {
    splitBall(state, b);
  } else if (kind === 'speed') {
    rescaleBalls(state, rand() < 0.5 ? SPEED_UP : SPEED_DOWN);
  }
}

function splitBall(state, b) {
  for (let i = 0; i < MULTI_EXTRA && state.balls.length < MAX_BALLS; i++) {
    const a = (i % 2 === 0 ? 1 : -1) * SPLIT_ANGLE;
    const c = Math.cos(a);
    const s = Math.sin(a);
    state.balls.push({ x: b.x, y: b.y, vx: b.vx * c - b.vy * s, vy: b.vx * s + b.vy * c, last: b.last });
  }
}

function rescaleBalls(state, factor) {
  for (const b of state.balls) {
    const speed = Math.hypot(b.vx, b.vy);
    if (speed === 0) continue;
    const next = clamp(speed * factor, MIN_SPEED, MAX_SPEED);
    b.vx *= next / speed;
    b.vy *= next / speed;
  }
}

function removeBall(state, b) {
  if (state.balls.length > 1) state.balls.splice(state.balls.indexOf(b), 1);
  else resetBall(state);
}

// Returns true when the ball left play (missed, not shielded).
function collide(state, b, events) {
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
      const scale = effectScale(owner);
      const pl = paddleLength(g.len, scale);
      const off = dx * g.tx + dy * g.ty - paddleCenter(g.len, owner.pos, scale);
      if (Math.abs(off) <= pl / 2 + r * 0.8) {
        paddleBounce(b, g, vn, clamp(off / (pl / 2), -1, 1));
        b.x += g.nx * (r - d);
        b.y += g.ny * (r - d);
        b.last = owner.id;
        events.push({ type: 'hit', id: owner.id });
        continue;
      }
    }

    if (d < -2 * r) {
      if (owner.fx.shield) {
        delete owner.fx.shield;
        b.vx -= 2 * vn * g.nx;
        b.vy -= 2 * vn * g.ny;
        b.x += g.nx * (r - d);
        b.y += g.ny * (r - d);
        events.push({ type: 'shield', id: owner.id });
        continue;
      }
      owner.lost++;
      events.push({ type: 'miss', id: owner.id });
      removeBall(state, b);
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
    return { id, name, lost, pos: prev ? prev.pos : 0, input: prev ? prev.input : 0, fx: prev ? prev.fx : {} };
  });
}

// [seq, rv, serve, nBalls, ...balls(x,y,vx,vy), nField, ...field(x,y,kindIndex,ttl), ...players(pos, big, small, shield)]
export function encodeSnapshot(state, seq, rv) {
  const out = [seq, rv, round4(state.serve), state.balls.length];
  for (const b of state.balls) out.push(round4(b.x), round4(b.y), round4(b.vx), round4(b.vy));
  out.push(state.bonus.field.length);
  for (const f of state.bonus.field) {
    out.push(round4(f.x), round4(f.y), BONUS_KINDS.indexOf(f.kind), round4(f.ttl));
  }
  for (const p of state.players) {
    out.push(round4(p.pos), ...TIMED_EFFECTS.map((k) => (p.fx[k] ? 1 : 0)));
  }
  return out;
}

export function applySnapshot(state, snap, rv, ownId) {
  if (!Array.isArray(snap) || snap.length < 5 || !snap.every(Number.isFinite)) return;
  const nBalls = snap[3];
  if (!Number.isInteger(nBalls) || nBalls < 0 || nBalls > MAX_BALLS) return;
  const fieldAt = 4 + 4 * nBalls;
  if (fieldAt >= snap.length) return;
  const nField = snap[fieldAt];
  if (!Number.isInteger(nField) || nField < 0 || nField > MAX_FIELD) return;
  const playersAt = fieldAt + 1 + 4 * nField;
  if (playersAt > snap.length) return;
  for (let i = 0; i < nField; i++) {
    if (!BONUS_KINDS[snap[fieldAt + 3 + 4 * i]]) return;
  }

  state.serve = snap[2];
  state.balls = [];
  for (let i = 0; i < nBalls; i++) {
    const o = 4 + 4 * i;
    state.balls.push({ x: snap[o], y: snap[o + 1], vx: snap[o + 2], vy: snap[o + 3] });
  }
  state.bonus.field = [];
  for (let i = 0; i < nField; i++) {
    const o = fieldAt + 1 + 4 * i;
    state.bonus.field.push({ x: snap[o], y: snap[o + 1], kind: BONUS_KINDS[snap[o + 2]], ttl: snap[o + 3] });
  }

  if (snap[1] !== rv || snap.length !== playersAt + 4 * state.players.length) return;
  state.players.forEach((p, i) => {
    const o = playersAt + 4 * i;
    if (p.id !== ownId) p.pos = clamp(snap[o], -1, 1);
    p.fx = {};
    TIMED_EFFECTS.forEach((k, j) => {
      if (snap[o + 1 + j]) p.fx[k] = EFFECT_TTL;
    });
  });
}

export function clampPos(v) {
  return clamp(Number(v) || 0, -1, 1);
}
