import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchSim, MAX_DT, BOT_ID } from '../src/sim-core.js';

const seeded = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('advance reports about 30 snapshots per second of simulated time', () => {
  const sim = new MatchSim(0, 'Host', seeded(7));
  let sends = 0;
  for (let i = 0; i < 60; i++) if (sim.advance(1 / 60).send) sends++;
  assert.ok(sends >= 29 && sends <= 31, `expected ~30 sends, got ${sends}`);
  assert.equal(sim.seq, sends);
});

test('add and remove bump the roster version; removing an unknown id changes nothing', () => {
  const sim = new MatchSim(0, 'Host', seeded(3));
  const rv = sim.rv;
  sim.addPlayer(5, 'Bob');
  assert.ok(sim.rv > rv);
  const after = sim.rv;
  assert.equal(sim.removePlayer(99), false);
  assert.equal(sim.rv, after);
  assert.equal(sim.removePlayer(5), true);
  assert.ok(sim.rv > after);
});

test('an AI opponent plays only while the host is alone', () => {
  const sim = new MatchSim(0, 'Host', seeded(3));
  const ids = () => sim.state.players.map((p) => p.id);
  assert.deepEqual(ids(), [0, BOT_ID]);
  sim.addPlayer(5, 'Bob');
  assert.deepEqual(ids(), [0, 5]);
  sim.removePlayer(5);
  assert.deepEqual(ids(), [0, BOT_ID]);
});

test('the AI paddle moves to chase the ball', () => {
  const sim = new MatchSim(0, 'Host', seeded(3));
  for (let i = 0; i < 600; i++) sim.advance(1 / 60);
  const bot = sim.state.players.find((p) => p.id === BOT_ID);
  assert.ok(bot.pos !== 0 || sim.state.balls.length === 0);
});

test('snapshot carries the current roster version and sequence', () => {
  const sim = new MatchSim(0, 'Host', seeded(3));
  sim.addPlayer(5, 'Bob');
  sim.advance(0.05);
  const snap = sim.snapshot();
  assert.equal(snap[0], sim.seq);
  assert.equal(snap[1], sim.roster().rv);
  assert.equal(snap.length, 5 + 4 * sim.state.players.length);
});

test('setPos clamps the paddle into the arena', () => {
  const sim = new MatchSim(0, 'Host', seeded(3));
  sim.addPlayer(5, 'Bob');
  sim.setPos(5, 5);
  assert.equal(sim.snapshot().at(-4), 1);
  sim.setPos(5, -9);
  assert.equal(sim.snapshot().at(-4), -1);
});

test('setInput moves the host paddle over time', () => {
  const sim = new MatchSim(0, 'Host', seeded(3));
  sim.setInput(0, 1);
  for (let i = 0; i < 10; i++) sim.advance(0.05);
  assert.ok(sim.state.players[0].pos > 0);
});

test('large time steps are clamped to MAX_DT', () => {
  const a = new MatchSim(0, 'Host', seeded(11));
  const b = new MatchSim(0, 'Host', seeded(11));
  a.advance(10);
  b.advance(MAX_DT);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('a miss flags the roster as changed', () => {
  const sim = new MatchSim(0, 'Host', seeded(5));
  sim.addPlayer(5, 'Bob');
  sim.state.serve = 0;
  // Aim at the host's side (side 0) off-centre while the host paddle sits at the far end.
  sim.state.balls = [{ x: 0, y: 0, vx: 0.17, vy: 0.42, last: null }];
  sim.setPos(0, -1);
  let flagged = false;
  for (let i = 0; i < 300 && !flagged; i++) {
    sim.setPos(0, -1);
    flagged = sim.advance(1 / 60).roster;
  }
  assert.ok(flagged, 'expected a miss');
  assert.equal(sim.state.players[0].lost, 1);
});
