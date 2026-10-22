import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, addPlayer, step, geometry, paddleLength, MIN_SPEED, BASE_SPEED,
  exportRoster, applyRoster, encodeSnapshot, applySnapshot,
} from '../src/game.js';
import {
  BIG_SCALE, SMALL_SCALE, MAX_BALLS, EFFECT_TTL, MAX_FIELD, effectScale,
} from '../src/bonus.js';

const makeState = (n) => {
  const s = createState();
  for (let i = 0; i < n; i++) addPlayer(s, i, `P${i}`);
  s.serve = 0;
  s.bonus.timer = 1000; // keep random spawns out of the way unless a test wants one
  return s;
};

const ball = (x, y, vx, vy, last = null) => ({ x, y, vx, vy, last });

test('a due spawn timer drops one pickup chosen by the random source', () => {
  const s = makeState(2);
  s.bonus.timer = 0.001;
  // rand() = 0.5 selects index 2 of the kinds list: 'multi'.
  step(s, 0.01, () => 0.5);
  assert.equal(s.bonus.field.length, 1);
  assert.equal(s.bonus.field[0].kind, 'multi');
});

test('no new pickup spawns while the field is full', () => {
  const s = makeState(2);
  for (let i = 0; i < MAX_FIELD; i++) s.bonus.field.push({ x: 0.9, y: 0.9, kind: 'big', ttl: 5 });
  s.bonus.timer = 0.001;
  step(s, 0.01, () => 0.5);
  assert.equal(s.bonus.field.length, MAX_FIELD);
});

test('uncollected pickups expire from the field', () => {
  const s = makeState(2);
  s.bonus.field.push({ x: 0.9, y: 0.9, kind: 'speed', ttl: 0.05 });
  step(s, 0.1, () => 0.5);
  assert.equal(s.bonus.field.length, 0);
});

test('the pickup goes to whichever paddle hit the ball last, and nobody collects without a hit', () => {
  const s = makeState(2);
  s.balls = [ball(0, 0, 0, 0, 1)];
  s.bonus.field.push({ x: 0.01, y: 0, kind: 'big', ttl: 5 });
  const events = step(s, 0.01, () => 0.5);
  assert.deepEqual(events.find((e) => e.type === 'collect'), { type: 'collect', id: 1, kind: 'big' });
  assert.equal(s.players[1].fx.big, EFFECT_TTL);
  assert.equal(s.players[0].fx.big, undefined);

  const idle = makeState(2);
  idle.balls = [ball(0, 0, 0, 0, null)];
  idle.bonus.field.push({ x: 0.01, y: 0, kind: 'big', ttl: 5 });
  const idleEvents = step(idle, 0.01, () => 0.5);
  assert.equal(idleEvents.some((e) => e.type === 'collect'), false);
  assert.equal(idle.bonus.field.length, 1);
});

test('the last hitter collects a big-bar pickup for itself', () => {
  const s = makeState(2);
  s.balls = [ball(0, 0, 0, 0, 0)];
  s.bonus.field.push({ x: 0.01, y: 0, kind: 'big', ttl: 5 });
  const events = step(s, 0.01, () => 0.5);
  assert.deepEqual(events.find((e) => e.type === 'collect'), { type: 'collect', id: 0, kind: 'big' });
  assert.equal(s.bonus.field.length, 0);
  assert.equal(s.players[0].fx.big, EFFECT_TTL);
  assert.equal(effectScale(s.players[0]), BIG_SCALE);
});

test('a small-bar pickup shrinks every rival but not the collector', () => {
  const s = makeState(3);
  s.balls = [ball(0, 0, 0, 0, 0)];
  s.bonus.field.push({ x: 0.01, y: 0, kind: 'small', ttl: 5 });
  step(s, 0.01, () => 0.5);
  assert.equal(effectScale(s.players[0]), 1);
  assert.equal(effectScale(s.players[1]), SMALL_SCALE);
  assert.equal(effectScale(s.players[2]), SMALL_SCALE);
});

test('big and small stack multiplicatively', () => {
  const s = makeState(2);
  s.players[0].fx.big = EFFECT_TTL;
  s.players[0].fx.small = EFFECT_TTL;
  assert.ok(Math.abs(effectScale(s.players[0]) - BIG_SCALE * SMALL_SCALE) < 1e-9);
});

test('a scaled paddle is longer than a normal one and stays within bounds', () => {
  const sideLen = geometry(4)[0].len;
  assert.ok(paddleLength(sideLen, BIG_SCALE) > paddleLength(sideLen));
  assert.ok(paddleLength(sideLen, SMALL_SCALE) < paddleLength(sideLen));
  assert.ok(paddleLength(sideLen, 100) <= 0.8 * sideLen + 1e-9);
});

test('shield reflects a would-be miss once, then is consumed', () => {
  const s = makeState(2);
  const g = geometry(4)[0];
  s.players[0].pos = -1; // paddle far to one side, so the ball would be missed
  s.players[0].fx.shield = EFFECT_TTL;
  s.balls = [ball(g.tx * 0.3, g.my + g.ny * 0.1, 0, BASE_SPEED)];
  let shielded = false;
  for (let i = 0; i < 60 && !shielded; i++) {
    const events = step(s, 0.05);
    assert.equal(events.some((e) => e.type === 'miss'), false, 'shield should prevent the miss');
    shielded = events.some((e) => e.type === 'shield' && e.id === 0);
  }
  assert.ok(shielded);
  assert.equal(s.players[0].lost, 0);
  assert.equal(s.players[0].fx.shield, undefined);
  assert.equal(s.balls.length, 1);
});

test('multi-ball adds balls up to the cap', () => {
  const s = makeState(2);
  s.balls = [ball(0, 0, 0, 0, 0), ball(0.5, 0.5, 0, 0, null)];
  s.bonus.field.push({ x: 0.01, y: 0, kind: 'multi', ttl: 5 });
  step(s, 0.01, () => 0.5);
  assert.equal(s.balls.length, MAX_BALLS);
});

test('speed pickup scales ball speed and clamps to the allowed range', () => {
  const up = makeState(2);
  up.balls = [ball(0, 0, 0.3, 0.4, 0)];
  up.bonus.field.push({ x: 0.01, y: 0, kind: 'speed', ttl: 5 });
  step(up, 0.001, () => 0.1); // rand < 0.5 selects the speed-up factor
  assert.ok(Math.abs(Math.hypot(up.balls[0].vx, up.balls[0].vy) - 0.5 * 1.5) < 1e-6);

  const down = makeState(2);
  down.balls = [ball(0, 0, 0.3, 0.4, 0)];
  down.bonus.field.push({ x: 0.01, y: 0, kind: 'speed', ttl: 5 });
  step(down, 0.001, () => 0.9); // slow-down would drop below the floor, so it clamps
  assert.ok(Math.abs(Math.hypot(down.balls[0].vx, down.balls[0].vy) - MIN_SPEED) < 1e-6);
});

test('paddle effects expire after their timer runs out', () => {
  const s = makeState(2);
  s.players[0].fx.big = 0.01;
  step(s, 0.05, () => 0.5);
  assert.equal(s.players[0].fx.big, undefined);
});

test('pickups and paddle effects survive a snapshot round trip', () => {
  const host = makeState(2);
  host.bonus.field.push({ x: 0.2, y: -0.3, kind: 'shield', ttl: 5 });
  host.players[1].fx.small = EFFECT_TTL;
  const client = createState();
  applyRoster(client, exportRoster(host));
  applySnapshot(client, encodeSnapshot(host, 1, 3), 3, 0);
  assert.equal(client.bonus.field.length, 1);
  assert.equal(client.bonus.field[0].kind, 'shield');
  assert.equal(client.bonus.field[0].x, 0.2);
  assert.equal(client.bonus.field[0].y, -0.3);
  assert.ok(client.players[1].fx.small);
  assert.equal(client.players[0].fx.small, undefined);
});
