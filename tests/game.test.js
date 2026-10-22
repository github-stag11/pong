import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, addPlayer, removePlayer, layout, geometry, step, sideOf, paddleLength,
  BALL_RADIUS, BASE_SPEED, MAX_SPEED, SERVE_DELAY,
  exportRoster, applyRoster, encodeSnapshot, applySnapshot,
} from '../src/game.js';

const makeState = (n) => {
  const s = createState();
  for (let i = 0; i < n; i++) addPlayer(s, i, `P${i}`);
  s.serve = 0;
  return s;
};

test('layout adds a side per player with sensible small-match shapes', () => {
  assert.deepEqual(layout(1), { sides: 4, slots: [0] });
  assert.deepEqual(layout(2), { sides: 4, slots: [0, 2] });
  assert.equal(layout(3).sides, 3);
  assert.equal(layout(12).sides, 12);
  assert.equal(layout(40).slots.length, 40);
});

test('geometry is a closed regular polygon with inward normals', () => {
  for (const n of [3, 4, 7, 20]) {
    const g = geometry(n);
    assert.equal(g.length, n);
    g.forEach((side, i) => {
      const next = g[(i + 1) % n];
      // The vertex shared with the neighbouring side coincides.
      assert.ok(Math.hypot(side.ax - next.bx, side.ay - next.by) < 1e-9, `n=${n} side ${i} not closed`);
      assert.ok(side.mx * side.nx + side.my * side.ny < 0, 'normal points inward');
    });
  }
  const bottom = geometry(4)[0];
  assert.ok(bottom.my > 0 && bottom.tx > 0, 'side 0 is at the bottom, tangent points right');
});

test('ball bounces off a wall without scoring', () => {
  const s = makeState(1); // only side 0 is a paddle; the rest are walls
  const top = geometry(4)[2];
  s.ball = { x: top.mx + top.nx * 0.05, y: top.my + top.ny * 0.05, vx: 0, vy: -1 };
  const events = step(s, 0.1);
  assert.ok(events.some((e) => e.type === 'wall'));
  assert.ok(s.ball.vy > 0);
  assert.equal(s.players[0].lost, 0);
});

test('paddle returns the ball and speeds it up; edge hits deflect', () => {
  const s = makeState(2);
  const g = geometry(4)[0];
  s.ball = { x: 0, y: g.my + g.ny * 0.05, vx: 0, vy: BASE_SPEED };
  const events = step(s, 0.1);
  assert.ok(events.some((e) => e.type === 'hit' && e.id === 0));
  assert.ok(s.ball.vy < 0);
  assert.ok(Math.hypot(s.ball.vx, s.ball.vy) > BASE_SPEED);

  const s2 = makeState(2);
  const pl = paddleLength(g.len);
  s2.ball = { x: pl / 2 - 0.01, y: g.my + g.ny * 0.05, vx: 0, vy: BASE_SPEED };
  step(s2, 0.1);
  assert.ok(Math.abs(s2.ball.vx) > 0.1, 'off-centre hit changes the angle');
});

test('missing the ball increments only that player\'s counter and re-serves', () => {
  const s = makeState(2);
  const g = geometry(4)[0];
  s.players[0].pos = -1; // paddle far to one side
  s.ball = { x: g.tx * 0.3, y: g.my + g.ny * 0.1, vx: 0, vy: BASE_SPEED };
  let missed = false;
  for (let i = 0; i < 60 && !missed; i++) missed = step(s, 0.05).some((e) => e.type === 'miss' && e.id === 0);
  assert.ok(missed);
  assert.equal(s.players[0].lost, 1);
  assert.equal(s.players[1].lost, 0);
  assert.equal(s.serve, SERVE_DELAY);
  assert.deepEqual([s.ball.x, s.ball.y], [0, 0]);
});

test('match runs indefinitely: ball stays inside the arena with many players', () => {
  for (const n of [1, 2, 3, 5, 9, 16]) {
    const s = makeState(n);
    s.players.forEach((p) => (p.input = 0));
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    s.serve = 0.01;
    for (let i = 0; i < 20000; i++) {
      if (i % 20 === 0) s.players.forEach((p) => (p.pos = rand() * 2 - 1)); // erratic players
      step(s, 1 / 60, rand);
      assert.ok(Math.hypot(s.ball.x, s.ball.y) < 1.2, `n=${n} ball escaped at step ${i}`);
      assert.ok(Math.hypot(s.ball.vx, s.ball.vy) <= MAX_SPEED + 1e-9);
    }
    // A lone idle paddle can legitimately rally forever (vertical bounce), so only check with 2+ players.
    assert.ok(n < 2 || s.players.reduce((a, p) => a + p.lost, 0) > 0, `n=${n} never scored`);
  }
});

test('players can join and leave; sides are reassigned', () => {
  const s = makeState(3);
  assert.equal(sideOf(s, 2), 2);
  assert.ok(removePlayer(s, 1));
  assert.equal(sideOf(s, 2), 2);
  assert.equal(layout(s.players.length).sides, 4);
  assert.equal(removePlayer(s, 99), false);
  addPlayer(s, 5, 'New');
  assert.equal(s.serve, SERVE_DELAY);
});

test('keyboard input moves the paddle and clamps at the ends', () => {
  const s = makeState(2);
  s.players[0].input = 1;
  for (let i = 0; i < 120; i++) step(s, 1 / 60, () => 0.5);
  assert.equal(s.players[0].pos, 1);
});

test('snapshots round-trip and ignore mismatched rosters', () => {
  const host = makeState(3);
  host.players[1].pos = 0.5;
  host.players[1].lost = 4;
  host.ball = { x: 0.1, y: -0.2, vx: 0.3, vy: 0.4 };
  const client = createState();
  applyRoster(client, exportRoster(host));
  assert.equal(client.players[1].lost, 4);

  applySnapshot(client, encodeSnapshot(host, 1, 7), 7, 0);
  assert.equal(client.players[1].pos, 0.5);
  assert.equal(client.ball.vy, 0.4);

  host.players[1].pos = -0.5;
  applySnapshot(client, encodeSnapshot(host, 2, 8), 7, 0);
  assert.equal(client.players[1].pos, 0.5, 'paddles ignored when roster version differs');

  applySnapshot(client, [1, 2, NaN], 7, 0);
  assert.equal(client.ball.vy, 0.4, 'garbage snapshot ignored');
});

test('ball radius is smaller than the shortest paddle', () => {
  assert.ok(BALL_RADIUS * 2 < paddleLength(geometry(60)[0].len));
});
